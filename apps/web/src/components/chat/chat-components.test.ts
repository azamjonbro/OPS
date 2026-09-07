import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageBlock } from '@/chat/message-content';
import ConfirmationCard from '@/components/chat/ConfirmationCard.vue';
import ContentPlanCard from '@/components/chat/ContentPlanCard.vue';
import GeneratedImageCard from '@/components/chat/GeneratedImageCard.vue';
import MessageComposer from '@/components/chat/MessageComposer.vue';
import MessageRenderer from '@/components/chat/MessageRenderer.vue';
import ReminderCard from '@/components/chat/ReminderCard.vue';
import ToolExecutionCard from '@/components/chat/ToolExecutionCard.vue';
import { reminderService } from '@/services/reminder.service';
import { useImagesStore } from '@/stores/images';
import { makeReminder, makeToolCall } from '@/test/factories';

beforeEach(() => {
  setActivePinia(createPinia());
});

describe('tool execution', () => {
  it('says what happened in the person’s terms, never the tool’s name', () => {
    const wrapper = mount(ToolExecutionCard, {
      props: { call: makeToolCall({ name: 'billz_get_sales_summary' }) },
    });

    // "Billz get sales summary" is the developer's name for it; the person
    // asked about savdo and should be told what was read, not which system.
    expect(wrapper.text()).toContain('Read the sales figures');
    expect(wrapper.text()).not.toContain('billz_get_sales_summary');
    expect(wrapper.text()).not.toContain('Billz get');
  });

  it('shows the present tense while a step is still running', () => {
    const wrapper = mount(ToolExecutionCard, {
      props: { call: makeToolCall({ name: 'generate_image' }), running: true },
    });

    expect(wrapper.text()).toContain('Creating the image');
    expect(wrapper.attributes('aria-busy')).toBe('true');
  });

  it('still names a step for a tool it has never heard of', () => {
    const wrapper = mount(ToolExecutionCard, {
      props: { call: makeToolCall({ name: 'search_notion' }) },
    });

    expect(wrapper.text()).toContain('Search notion');
  });
});

describe('the content plan card', () => {
  const plan = {
    id: 'plan-1',
    title: '7 kunlik plan',
    platform: 'instagram',
    startDate: '2026-09-05',
    endDate: '2026-09-11',
    itemCount: 2,
    items: [
      {
        day: 1,
        date: '2026-09-05',
        contentType: 'post',
        title: 'Mahsulot posti',
        idea: 'Cola',
        caption: 'Yangi kelgan!',
        callToAction: 'Do‘konga keling',
        hashtags: ['cola'],
      },
      {
        day: 2,
        date: '2026-09-06',
        contentType: 'reel',
        title: 'Reel',
        idea: 'Kunlik ish',
        caption: null,
        callToAction: null,
        hashtags: [],
      },
    ],
  };

  it('lists every day by its headline', () => {
    const wrapper = mount(ContentPlanCard, { props: { plan } });

    expect(wrapper.text()).toContain('7 kunlik plan');
    expect(wrapper.text()).toContain('Mahsulot posti');
    expect(wrapper.text()).toContain('Reel');
  });

  it('opens a day to its caption and hashtags on request', async () => {
    const wrapper = mount(ContentPlanCard, { props: { plan } });

    expect(wrapper.text()).not.toContain('Yangi kelgan!');

    const day = wrapper
      .findAll('button')
      .find((candidate) => candidate.text().includes('Mahsulot posti'));
    await day?.trigger('click');

    expect(wrapper.text()).toContain('Yangi kelgan!');
    expect(wrapper.text()).toContain('#cola');
  });
});

describe('the reminder card', () => {
  const reminder = {
    id: 'rem-1',
    title: 'Omborni tekshir',
    description: null,
    scheduledAt: '2026-09-06T05:00:00.000Z',
    localScheduledAt: '2026-09-06 10:00',
    timezone: 'Asia/Tashkent',
    status: 'scheduled',
    recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
  };

  it('shows the wall clock and the zone, because one without the other is ambiguous', () => {
    const wrapper = mount(ReminderCard, { props: { reminder } });

    expect(wrapper.text()).toContain('Omborni tekshir');
    expect(wrapper.text()).toContain('2026-09-06 10:00');
    expect(wrapper.text()).toContain('Asia/Tashkent');
    expect(wrapper.text()).toContain('FREQ=WEEKLY;BYDAY=MO');
  });

  it('cancels through the reminders API rather than deciding locally', async () => {
    const cancel = vi
      .spyOn(reminderService, 'cancel')
      .mockResolvedValue({ ...makeReminder(), status: 'cancelled' } as never);

    const wrapper = mount(ReminderCard, { props: { reminder } });
    const button = wrapper
      .findAll('button')
      .find((candidate) => candidate.text() === 'Cancel reminder');

    await button?.trigger('click');
    await flushPromises();

    expect(cancel).toHaveBeenCalledWith('rem-1');
    expect(wrapper.text()).toContain('cancelled');
  });
});

describe('a generated image', () => {
  const image = {
    id: 'img-1',
    url: null,
    prompt: 'A cola bottle',
    revisedPrompt: null,
    status: 'completed',
    aspectRatio: '1:1',
    contentItemId: null,
  };

  it('fetches the bytes once, however often it re-renders', async () => {
    const images = useImagesStore();
    const objectUrl = vi.spyOn(images, 'objectUrlFor').mockResolvedValue('blob:generated-image-1');

    const wrapper = mount(GeneratedImageCard, { props: { images: [image] } });
    await flushPromises();

    expect(wrapper.find('img').attributes('src')).toBe('blob:generated-image-1');

    // A re-render with the same image must not generate or re-download it.
    await wrapper.setProps({ images: [image] });
    await flushPromises();

    expect(objectUrl).toHaveBeenCalledTimes(1);
  });

  it('says so when the image could not be created', () => {
    const wrapper = mount(GeneratedImageCard, {
      props: { images: [{ ...image, status: 'failed' }] },
    });

    expect(wrapper.text()).toContain('could not be created');
    expect(wrapper.find('img').exists()).toBe(false);
  });

  it('shows a placeholder while one is still being drawn', () => {
    const wrapper = mount(GeneratedImageCard, {
      props: { images: [{ ...image, status: 'generating' }] },
    });

    expect(wrapper.text()).toContain('Creating…');
  });
});

describe('the block renderer', () => {
  const render = (blocks: MessageBlock[]) => mount(MessageRenderer, { props: { blocks } });

  it('renders markdown for a text block', () => {
    const wrapper = render([{ kind: 'text', text: '**12 ta** savdo' }]);

    expect(wrapper.html()).toContain('<strong>12 ta</strong>');
  });

  it('renders rows as a table', () => {
    const wrapper = render([
      {
        kind: 'table',
        call: makeToolCall({ name: 'get_products' }),
        table: {
          columns: [
            { key: 'name', label: 'Name', money: false },
            { key: 'price', label: 'Price', money: true },
          ],
          rows: [{ name: 'Cola 1L', price: 1_200_000 }],
          total: 1,
        },
      },
    ]);

    expect(wrapper.find('table').exists()).toBe(true);
    expect(wrapper.text()).toContain('Cola 1L');
    // Money arrives in minor units and must reach the reader as currency, not
    // as 1200000. The separators `Intl` inserts are non-breaking, so they are
    // normalised before the comparison rather than guessed at.
    expect(wrapper.text().replace(/[\u00a0\u202f]/g, ' ')).toContain('12 000');
  });

  it('renders a failed step as an error, not as a result', () => {
    const wrapper = render([
      {
        kind: 'error',
        call: makeToolCall({ name: 'billz_get_sales_summary', status: 'failed' }),
        message: 'Reading the sales figures — that step did not work.',
        detail: 'Billz answered 405 for /v1/auth/login',
      },
    ]);

    expect(wrapper.text()).toContain('that step did not work');
    // The upstream wording names a host and a path; it belongs behind the
    // toggle, not in the sentence the shopkeeper reads.
    expect(wrapper.find('p').text()).not.toContain('/v1/auth/login');
    expect(wrapper.find('details').text()).toContain('/v1/auth/login');
  });

  it('turns a confirmation into an ordinary chat reply', async () => {
    const wrapper = render([
      {
        kind: 'confirmation',
        call: makeToolCall({ status: 'needs_confirmation' }),
        question: 'Delete “7 kunlik plan”?',
      },
    ]);

    expect(wrapper.text()).toContain('Delete “7 kunlik plan”?');

    await wrapper.findComponent(ConfirmationCard).findAll('button')[0]?.trigger('click');

    // The answer goes back through the chat, not to a second approval endpoint.
    expect(wrapper.emitted('reply')?.[0]).toEqual(['Ha, davom et']);
  });
});

describe('the composer', () => {
  const textareaOf = (wrapper: ReturnType<typeof mount>) => wrapper.find('textarea');

  /** The send control, by its label — the composer has several buttons. */
  const sendButton = (wrapper: ReturnType<typeof mount>) =>
    wrapper.find('button[aria-label="Send message"], button[aria-label="Hadiya is answering"]');

  it('sends on Enter and clears itself', async () => {
    const wrapper = mount(MessageComposer);
    const textarea = textareaOf(wrapper);

    await textarea.setValue('Bugungi savdo?');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')?.[0]).toEqual(['Bugungi savdo?', []]);
    expect((textarea.element as HTMLTextAreaElement).value).toBe('');
  });

  it('breaks the line on Shift+Enter instead of sending', async () => {
    const wrapper = mount(MessageComposer);
    const textarea = textareaOf(wrapper);

    await textarea.setValue('Birinchi qator');
    await textarea.trigger('keydown', { key: 'Enter', shiftKey: true });

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('does not send a half-written word from an IME', async () => {
    const wrapper = mount(MessageComposer);
    const textarea = textareaOf(wrapper);

    await textarea.setValue('savdo');
    await textarea.trigger('keydown', { key: 'Enter', isComposing: true });

    expect(wrapper.emitted('send')).toBeUndefined();
  });

  it('refuses to send nothing but whitespace', async () => {
    const wrapper = mount(MessageComposer);
    const textarea = textareaOf(wrapper);

    await textarea.setValue('   ');
    await textarea.trigger('keydown', { key: 'Enter' });

    expect(wrapper.emitted('send')).toBeUndefined();
    // Found by its label rather than by position: the composer holds several
    // buttons now, and "the first one" is not a stable way to name this one.
    expect(sendButton(wrapper).attributes('disabled')).toBeDefined();
  });

  it('keeps the field usable while the assistant is answering', () => {
    const wrapper = mount(MessageComposer, { props: { busy: true } });

    // Only sending waits; disabling the field would close the keyboard on a
    // phone mid-sentence.
    expect(textareaOf(wrapper).attributes('disabled')).toBeUndefined();
    expect(sendButton(wrapper).attributes('disabled')).toBeDefined();
  });
});
