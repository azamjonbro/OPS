import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia, type Pinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRouter, createWebHistory, type Router } from 'vue-router';

import * as agentStream from '@/services/agent-stream';
import { ApiClientError } from '@/services/api-error';
import { branchService } from '@/services/branch.service';
import { chatService } from '@/services/chat.service';
import { conversationService } from '@/services/conversation.service';
import { notificationService } from '@/services/notification.service';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';
import {
  makeAgentEvent,
  makeChatResponse,
  makeConversation,
  makeMessage,
  makeToolEvent,
  makeUser,
  paginated,
  resetAgentEventSequence,
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

  // The turn is streamed in the browser, and `fetch` is not something a page
  // test should be reaching for. The stub delivers the run through whatever
  // `chatService.send` each test has set up, so these tests go on asserting on
  // the turn rather than on the transport underneath it.
  // Opening a thread asks the server whether a run is still going there. There
  // is not one by default, and a page test should not be reaching a port to
  // find that out.
  vi.spyOn(chatService, 'activeRun').mockResolvedValue({ run: null });

  vi.spyOn(agentStream, 'streamChat').mockImplementation(async (input, handlers) => {
    handlers.onReady?.({ runId: 'run-1', conversationId: input.conversationId ?? '' });

    try {
      handlers.onResult(await chatService.send(input.message, input.conversationId));
    } catch (caught) {
      handlers.onFailure(caught as ApiClientError);
    }
  });
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

describe('watching a turn happen', () => {
  /**
   * Drives the page through a scripted run.
   *
   * The events are exactly the shape the server emits, so what is asserted
   * below is what a person would actually see — including, in the last test,
   * seeing a failure reported as a failure.
   */
  const runScript = (
    events: ReturnType<typeof makeAgentEvent>[],
    response = makeChatResponse(),
  ) => {
    vi.mocked(agentStream.streamChat).mockImplementation(async (input, handlers) => {
      handlers.onReady?.({ runId: 'run-1', conversationId: input.conversationId ?? 'c-1' });

      for (const event of events) {
        handlers.onEvent(event);
        await Promise.resolve();
      }

      handlers.onResult(response);
    });
  };

  const openThread = async () => {
    const conversation = makeConversation();
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([]));

    return { conversation, wrapper: await mountPage(`/assistant/${conversation.id}`) };
  };

  beforeEach(resetAgentEventSequence);

  it('draws a truthful timeline for a workflow where one step failed', async () => {
    const { wrapper } = await openThread();

    // The four steps of the phase's own example, with the labels the server
    // would have sent for each.
    const step = (callId: string, name: string, running: string, done: string) => ({
      callId,
      displayName: name,
      runningLabel: running,
      doneLabel: done,
    });

    runScript([
      makeAgentEvent('agent.started', { tools: 20 }),
      makeToolEvent(
        'tool.started',
        step('billz', 'Sales figures', 'Reading the sales figures', 'Read the sales figures'),
      ),
      makeToolEvent(
        'tool.completed',
        step('billz', 'Sales figures', 'Reading the sales figures', 'Read the sales figures'),
      ),
      makeToolEvent(
        'tool.started',
        step('content', 'Content plan', 'Writing the content plan', 'Content plan saved'),
      ),
      makeToolEvent(
        'tool.completed',
        step('content', 'Content plan', 'Writing the content plan', 'Content plan saved'),
      ),
      makeToolEvent('tool.started', step('image', 'Image', 'Creating the image', 'Image created')),
      makeToolEvent(
        'tool.completed',
        step('image', 'Image', 'Creating the image', 'Image created'),
      ),
      makeToolEvent(
        'tool.started',
        step('notion', 'Notion', 'Saving to Notion', 'Saved to Notion'),
      ),
      makeToolEvent('tool.failed', {
        ...step('notion', 'Notion', 'Saving to Notion', 'Saved to Notion'),
        message: 'Notion is unreachable',
      }),
      makeAgentEvent('agent.completed', { state: 'recovering' }),
    ]);

    await wrapper.find('textarea').setValue('Savdoni analiz qil va Notionga saqla');
    await wrapper.find('[aria-label="Send message"]').trigger('click');
    await flushPromises();

    // The finished ledger collapses to a checkable summary, and opens on ask.
    expect(wrapper.text()).toContain("4 steps · 1 didn't work");

    await wrapper.find('[aria-label="What Hadiya is doing"] button').trigger('click');

    const text = wrapper.text();

    // Every step that ran, named as a person would name it.
    expect(text).toContain('Read the sales figures');
    expect(text).toContain('Content plan saved');
    expect(text).toContain('Image created');
    // And the one that did not, said plainly rather than glossed over. The
    // past-tense "Saved to Notion" must not appear for a step that failed.
    expect(text).toContain('Notion is unreachable');
    expect(text).not.toContain('Saved to Notion');
  });

  it('shows the answer as it is written', async () => {
    const { wrapper } = await openThread();

    vi.mocked(agentStream.streamChat).mockImplementation(async (input, handlers) => {
      handlers.onReady?.({ runId: 'run-1', conversationId: input.conversationId ?? 'c-1' });
      handlers.onEvent(makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: 'Bugungi ' }));
      handlers.onEvent(
        makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: 'savdo yaxshi' }),
      );
      // Left unsettled so the partial answer is what is on screen.
      await Promise.resolve();
    });

    await wrapper.find('textarea').setValue('Savdo?');
    await wrapper.find('[aria-label="Send message"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('Bugungi savdo yaxshi');
  });

  it('offers Stop while a run is going, and stops offering it once asked', async () => {
    const { conversation, wrapper } = await openThread();
    const cancel = vi.spyOn(chatService, 'cancel').mockResolvedValue({
      conversationId: conversation.id,
      cancelledRuns: 1,
      cancelledActions: 0,
    });

    vi.mocked(agentStream.streamChat).mockImplementation(async (input, handlers) => {
      handlers.onReady?.({ runId: 'run-1', conversationId: input.conversationId ?? 'c-1' });
      handlers.onEvent(makeAgentEvent('agent.started', {}));
      await Promise.resolve();
    });

    await wrapper.find('textarea').setValue('Uzoq ish');
    await wrapper.find('[aria-label="Send message"]').trigger('click');
    await flushPromises();

    const stop = wrapper.find('[aria-label="Stop Hadiya"]');
    expect(stop.exists()).toBe(true);

    await stop.trigger('click');
    await flushPromises();

    expect(cancel).toHaveBeenCalledWith(conversation.id);
    expect(wrapper.find('[aria-label="Stop Hadiya"]').exists()).toBe(false);
  });

  it('asks before a write, and the card cannot run it', async () => {
    const { wrapper } = await openThread();

    vi.mocked(agentStream.streamChat).mockImplementation(async (input, handlers) => {
      handlers.onReady?.({ runId: 'run-1', conversationId: input.conversationId ?? 'c-1' });
      handlers.onEvent(
        makeAgentEvent('confirmation.required', {
          callId: 'call-1',
          pendingActionId: 'pa-1',
          tool: 'crm_invoice',
          displayName: 'Invoice',
          title: 'Invoice',
          description: 'create an invoice for 1 200 000 UZS',
          integration: 'My CRM',
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
        }),
      );
      handlers.onResult(makeChatResponse());
    });

    await wrapper.find('textarea').setValue('Invoice yarat');
    await wrapper.find('[aria-label="Send message"]').trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('create an invoice for 1 200 000 UZS');
    expect(wrapper.text()).toContain('It has not done it yet');
  });

  it('picks up a run that was already going when the page opened', async () => {
    const conversation = makeConversation();
    vi.spyOn(conversationService, 'list').mockResolvedValue(paginated([conversation]));
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([]));

    vi.spyOn(chatService, 'activeRun').mockResolvedValue({
      run: {
        runId: 'run-7',
        conversationId: conversation.id,
        state: 'executing',
        active: true,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        events: [makeToolEvent('tool.started', { displayName: 'Sales figures' })],
        summary: null,
      },
    });

    const watch = vi.spyOn(agentStream, 'watchRun').mockResolvedValue(undefined);

    const wrapper = await mountPage(`/assistant/${conversation.id}`);
    await flushPromises();

    // The run is recovered from the server rather than from anything this tab
    // remembered, because after a reload it remembers nothing.
    expect(watch).toHaveBeenCalledWith('run-7', expect.anything(), expect.anything());
    expect(wrapper.text()).toContain('Reading the sales figures');
  });
});
