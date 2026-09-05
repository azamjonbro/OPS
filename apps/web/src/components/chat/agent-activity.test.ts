import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import type { ActivityStep, PendingConfirmation } from '@/chat/agent-run';
import AgentActivity from '@/components/chat/AgentActivity.vue';
import MessageComposer from '@/components/chat/MessageComposer.vue';
import PendingActionCard from '@/components/chat/PendingActionCard.vue';
import StreamingAnswer from '@/components/chat/StreamingAnswer.vue';

/**
 * What a person sees while Hadiya works.
 *
 * These test the two things the interface is answerable for: that it says only
 * what the server said, and that it says it in a way somebody can act on —
 * including somebody who cannot distinguish the brand colour from the danger
 * one, or who is not using a mouse.
 */

const aStep = (overrides: Partial<ActivityStep> = {}): ActivityStep => ({
  callId: 'call-1',
  toolName: 'billz_get_sales_summary',
  displayName: 'Sales figures',
  runningLabel: 'Reading the sales figures',
  doneLabel: 'Read the sales figures',
  category: 'business',
  risk: 'read',
  integration: 'Billz',
  status: 'running',
  wave: 1,
  attempts: 1,
  durationMs: null,
  message: null,
  ...overrides,
});

describe('the activity ledger', () => {
  it('says what is happening in the present tense while it happens', () => {
    const wrapper = mount(AgentActivity, { props: { steps: [aStep()], active: true } });

    expect(wrapper.text()).toContain('Reading the sales figures');
    expect(wrapper.text()).not.toContain('billz_get_sales_summary');
  });

  it('switches to the past tense once the step is done', () => {
    const wrapper = mount(AgentActivity, {
      props: { steps: [aStep({ status: 'completed', durationMs: 210 })], active: false },
    });

    expect(wrapper.text()).toContain('Read the sales figures');
  });

  it('never carries state in colour alone', () => {
    const wrapper = mount(AgentActivity, {
      props: {
        steps: [
          aStep({ callId: 'a', status: 'completed' }),
          aStep({ callId: 'b', status: 'failed', message: 'Notion is unreachable' }),
        ],
        active: false,
      },
    });

    // Each row carries its own mark — a tick or a cross — so the two are
    // distinguishable without seeing green and red.
    const marks = wrapper.findAll('li svg path').map((node) => node.attributes('d'));

    expect(new Set(marks).size).toBe(marks.length);
    expect(wrapper.text()).toContain('Notion is unreachable');
  });

  it('shows work that happened together as one group', () => {
    const wrapper = mount(AgentActivity, {
      props: {
        steps: [
          aStep({ callId: 'a', displayName: 'Sales', wave: 1 }),
          aStep({ callId: 'b', displayName: 'Expenses', wave: 1 }),
          aStep({ callId: 'c', displayName: 'Debts', wave: 2 }),
        ],
        active: true,
      },
    });

    // One bracket, joining the first two: the third waited, and the ledger must
    // not imply otherwise in either direction.
    expect(wrapper.findAll('[title="ran at the same time"]')).toHaveLength(1);
  });

  it('collapses once the work is history, and can be reopened', async () => {
    const wrapper = mount(AgentActivity, {
      props: { steps: [aStep({ status: 'completed' })], active: true },
    });

    expect(wrapper.findAll('li')).toHaveLength(1);

    await wrapper.setProps({ active: false });
    expect(wrapper.findAll('li')).toHaveLength(0);
    // A finished ledger steps back, but it is still there to be read.
    expect(wrapper.text()).toContain('1 step');

    await wrapper.find('button').trigger('click');
    expect(wrapper.findAll('li')).toHaveLength(1);
  });

  it('counts failures rather than describing them vaguely', async () => {
    const wrapper = mount(AgentActivity, {
      props: {
        steps: [
          aStep({ callId: 'a', status: 'completed' }),
          aStep({ callId: 'b', status: 'failed', displayName: 'Notion' }),
        ],
        active: false,
      },
    });

    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain("2 steps · 1 didn't work");
  });

  it('says when the connection dropped and is being picked back up', () => {
    const wrapper = mount(AgentActivity, {
      props: { steps: [aStep()], active: true, reconnecting: true },
    });

    expect(wrapper.text()).toContain('Reconnecting');
  });

  it('announces the run to a screen reader without reading every row again', () => {
    const wrapper = mount(AgentActivity, { props: { steps: [aStep()], active: true } });
    const live = wrapper.find('[aria-live="polite"]');

    expect(live.exists()).toBe(true);
    expect(live.text()).toContain('Reading the sales figures');
  });
});

describe('an action waiting on a person', () => {
  const aProposal = (expiresInMs: number): PendingConfirmation => ({
    pendingActionId: 'pa-1',
    toolCallId: 'call-1',
    title: 'Invoice',
    description: 'create an invoice for 1 200 000 UZS',
    integration: 'My CRM',
    expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  });

  it('says what will happen and that it has not happened yet', () => {
    const wrapper = mount(PendingActionCard, { props: { confirmation: aProposal(300_000) } });

    expect(wrapper.text()).toContain('create an invoice for 1 200 000 UZS');
    expect(wrapper.text()).toContain('It has not done it yet');
    expect(wrapper.text()).toContain('My CRM');
  });

  it('answers by sending an ordinary message, never by authorising anything', async () => {
    const wrapper = mount(PendingActionCard, { props: { confirmation: aProposal(300_000) } });

    await wrapper.findAll('button')[0]?.trigger('click');

    // The card emits a reply for the conversation. The server's confirmation
    // gate is what actually decides, and this cannot bypass it.
    expect(wrapper.emitted('reply')?.[0]).toEqual(['Ha, davom et']);
  });

  it('withdraws the buttons once the offer has lapsed', () => {
    const wrapper = mount(PendingActionCard, { props: { confirmation: aProposal(-1_000) } });

    expect(wrapper.findAll('button')).toHaveLength(0);
    expect(wrapper.text()).toContain('waiting too long');
  });
});

describe('the answer as it arrives', () => {
  it('shows the text so far', () => {
    const wrapper = mount(StreamingAnswer, { props: { text: 'Bugungi savdo' } });

    expect(wrapper.text()).toContain('Bugungi savdo');
    expect(wrapper.find('[aria-live="polite"]').exists()).toBe(true);
  });
});

describe('stopping a run', () => {
  it('offers Stop only once there is a run to stop', async () => {
    const wrapper = mount(MessageComposer, { props: { busy: true, stoppable: false } });

    expect(wrapper.find('[aria-label="Stop Hadiya"]').exists()).toBe(false);

    await wrapper.setProps({ stoppable: true });
    expect(wrapper.find('[aria-label="Stop Hadiya"]').exists()).toBe(true);
  });

  it('asks once, and stops offering while the request is in flight', async () => {
    const wrapper = mount(MessageComposer, {
      props: { busy: true, stoppable: true, stopping: false },
    });

    await wrapper.find('[aria-label="Stop Hadiya"]').trigger('click');
    expect(wrapper.emitted('stop')).toHaveLength(1);

    await wrapper.setProps({ stopping: true });
    // The button is gone, so a second press cannot happen by accident.
    expect(wrapper.find('[aria-label="Stop Hadiya"]').exists()).toBe(false);
  });

  it('leaves dictation alone: a transcript is a draft, never a sent message', async () => {
    const wrapper = mount(MessageComposer, { props: { busy: false, stoppable: false } });

    await wrapper.find('textarea').setValue('Bugungi savdo');

    expect(wrapper.emitted('send')).toBeUndefined();
  });
});
