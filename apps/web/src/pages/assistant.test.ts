import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, createWebHistory, type Router } from 'vue-router';

import { ApiClientError } from '@/services/api-error';
import { branchService } from '@/services/branch.service';
import { chatService } from '@/services/chat.service';
import { conversationService } from '@/services/conversation.service';
import { notificationService } from '@/services/notification.service';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import {
  makeChatResponse,
  makeConversation,
  makeMessage,
  makeUser,
  paginated,
} from '@/test/factories';
import { routes } from '@/router/routes';
import AssistantPage from './AssistantPage.vue';

/**
 * The assistant screen, driven through a real router with a mocked API.
 *
 * A real router rather than a stub, because the conversation id lives in the
 * URL: opening a thread, starting a new one and deleting the open one are all
 * navigations, and a stubbed `RouterLink` would let a broken one pass.
 */
let pinia: Pinia;
let router: Router;

const signIn = () => {
  const auth = useAuthStore();
  auth.user = makeUser();
};

beforeEach(async () => {
  pinia = createPinia();
  setActivePinia(pinia);

  router = createRouter({ history: createWebHistory(), routes });

  vi.spyOn(chatService, 'status').mockResolvedValue({
    provider: 'anthropic',
    available: true,
    model: 'claude-opus-5',
    reason: null,
    tools: [],
  });

  // The header carries the branch selector and the unread badge, which fetch on
  // mount like they do on every other screen. Stubbed so the suite never opens
  // a socket — a test that reaches a real port passes or fails on the weather.
  vi.spyOn(branchService, 'list').mockResolvedValue(paginated([]));
  vi.spyOn(notificationService, 'unreadCount').mockResolvedValue({ unread: 0 });
});

const mountPage = async (path = '/assistant') => {
  await router.push(path);
  await router.isReady();

  const wrapper = mount(AssistantPage, {
    attachTo: document.body,
    global: { plugins: [pinia, router] },
  });

  await flushPromises();

  return wrapper;
};

describe('a new conversation', () => {
  it('offers suggestions and creates nothing server-side until a turn is sent', async () => {
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([]));
    const create = vi.spyOn(conversationService, 'create');

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('How can I help your business today?');
    expect(create).not.toHaveBeenCalled();
  });

  it('puts a suggestion in the composer so it can still be edited', async () => {
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([]));
    const send = vi.spyOn(chatService, 'send');

    const wrapper = await mountPage();
    const suggestion = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Bugungi savdoni tahlil qil'));

    await suggestion?.trigger('click');
    await flushPromises();

    expect((wrapper.find('textarea').element as HTMLTextAreaElement).value).toBe(
      'Bugungi savdoni tahlil qil',
    );
    // Picking a suggestion is not sending it.
    expect(send).not.toHaveBeenCalled();
  });

  it('moves the conversation id into the URL once the first reply arrives', async () => {
    const conversation = makeConversation();
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(
      paginated([makeMessage({ role: 'user', content: 'Salom' }), makeMessage()]),
    );
    vi.spyOn(chatService, 'send').mockResolvedValue(
      makeChatResponse({ conversationId: conversation.id }),
    );

    const wrapper = await mountPage();
    const textarea = wrapper.find('textarea');

    await textarea.setValue('Salom');
    await textarea.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(chatService.send).toHaveBeenCalledWith('Salom', undefined);
    expect(router.currentRoute.value.params.id).toBe(conversation.id);
  });
});

describe('an existing conversation', () => {
  it('loads it from the id in the URL', async () => {
    const conversation = makeConversation({ title: 'Sentyabr savdosi' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(
      paginated([
        makeMessage({ role: 'user', content: 'Bugungi savdo?' }),
        makeMessage({ role: 'assistant', content: '12 ta savdo bo‘ldi.' }),
      ]),
    );

    const wrapper = await mountPage(`/assistant/${conversation.id}`);

    expect(conversationService.get).toHaveBeenCalledWith(conversation.id);
    expect(wrapper.text()).toContain('Sentyabr savdosi');
    expect(wrapper.text()).toContain('Bugungi savdo?');
    expect(wrapper.text()).toContain('12 ta savdo bo‘ldi.');
  });

  it('shows a useful sentence when the assistant cannot be reached', async () => {
    const conversation = makeConversation();
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));
    vi.spyOn(chatService, 'send').mockRejectedValue(
      new ApiClientError('openai key rejected', {
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
      }),
    );

    const wrapper = await mountPage(`/assistant/${conversation.id}`);
    const textarea = wrapper.find('textarea');

    await textarea.setValue('Savdo?');
    await textarea.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    expect(wrapper.text()).toContain('The AI service is not responding right now');
    expect(wrapper.text()).not.toContain('openai key rejected');
    expect(wrapper.text()).toContain('Try again');
  });
});

describe('the conversation sidebar', () => {
  it('lists the threads by date and marks the open one', async () => {
    const conversation = makeConversation({ title: 'Bugungi savdo' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));

    const wrapper = await mountPage(`/assistant/${conversation.id}`);

    expect(wrapper.text()).toContain('Today');
    expect(wrapper.find('[aria-current="page"]').text()).toContain('Bugungi savdo');
  });

  it('opens a thread by navigating to it', async () => {
    const open = makeConversation({ title: 'Open' });
    const other = makeConversation({ title: 'Other' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([open, other]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(open);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));

    const wrapper = await mountPage(`/assistant/${open.id}`);
    const row = wrapper.findAll('button').find((candidate) => candidate.text() === 'Other');

    await row?.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.params.id).toBe(other.id);
  });

  it('renames a thread through the API', async () => {
    const conversation = makeConversation({ title: 'Old title' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));
    const rename = vi
      .spyOn(conversationService, 'rename')
      .mockResolvedValue({ ...conversation, title: 'Sentyabr' });

    const wrapper = await mountPage(`/assistant/${conversation.id}`);

    await wrapper.find(`[aria-label="Actions for Old title"]`).trigger('click');
    const renameButton = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Rename');
    await renameButton?.trigger('click');
    await flushPromises();

    const field = wrapper.find('input[aria-label="Conversation title"]');
    await field.setValue('Sentyabr');
    await field.trigger('keydown.enter');
    await flushPromises();

    expect(rename).toHaveBeenCalledWith(conversation.id, 'Sentyabr');
  });

  it('asks before deleting, and names the thread it is about to destroy', async () => {
    const conversation = makeConversation({ title: 'Doomed thread' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));
    const remove = vi.spyOn(conversationService, 'remove').mockResolvedValue(undefined);

    const wrapper = await mountPage(`/assistant/${conversation.id}`);

    await wrapper.find(`[aria-label="Actions for Doomed thread"]`).trigger('click');
    const deleteButton = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Delete');
    await deleteButton?.trigger('click');
    await flushPromises();

    const dialog = document.querySelector('[role="dialog"]');

    expect(remove).not.toHaveBeenCalled();
    expect(dialog?.textContent).toContain('Doomed thread');

    const confirm = [...(dialog?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent?.trim() === 'Delete',
    );
    confirm?.click();
    await flushPromises();

    expect(remove).toHaveBeenCalledWith(conversation.id);
    // The open thread is gone, so the screen goes back to a fresh one.
    expect(router.currentRoute.value.name).toBe('assistant');

    wrapper.unmount();
  });
});

describe('on a small screen', () => {
  it('keeps the drawer closed until it is asked for, and closes it on navigation', async () => {
    const first = makeConversation({ title: 'First' });
    const second = makeConversation({ title: 'Second' });
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([first, second]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(first);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));

    const wrapper = await mountPage(`/assistant/${first.id}`);
    const ui = useUiStore();

    expect(ui.mobileSidebarOpen).toBe(false);

    await wrapper.find('[aria-label="Open conversations"]').trigger('click');

    expect(ui.mobileSidebarOpen).toBe(true);

    const row = wrapper.findAll('button').find((candidate) => candidate.text() === 'Second');
    await row?.trigger('click');
    await flushPromises();

    // Opening a thread on a phone should show the thread, not the drawer.
    expect(ui.mobileSidebarOpen).toBe(false);
  });
});

describe('the signed-in employee', () => {
  it('is shown in the sidebar, and the route requires a session', async () => {
    signIn();
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([]));

    const wrapper = await mountPage();

    expect(wrapper.text()).toContain('Test Manager');
    expect(router.currentRoute.value.meta.requiresAuth).toBe(true);
  });
});
