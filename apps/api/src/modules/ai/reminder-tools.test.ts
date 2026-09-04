import { DEFAULT_TIMEZONE, type AuthenticatedUser } from '@hadiya/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { registerJobHandler, resetJobHandlers, runDueJobs } from '../../core/scheduler/index.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import * as memoryService from '../memory/memory.service.js';
import { NotificationModel } from '../notifications/notification.model.js';
import {
  registerNotificationProvider,
  resetNotificationProviders,
} from '../notifications/providers/index.js';
import { inAppNotificationProvider } from '../notifications/providers/in-app.provider.js';
import { ReminderModel, type ReminderDocument } from '../reminders/reminder.model.js';
import { registerReminderJobs } from '../reminders/reminder.jobs.js';
import { sendMessage } from './agent/agent.service.js';
import { buildSystemPrompt } from './context/context-builder.service.js';
import { setAiProvider } from './provider/index.js';
import { createScriptedProvider } from './test-support.js';
import { createToolRegistry } from './tools/index.js';

/**
 * The assistant's route to a reminder.
 *
 * The tools are exercised through the same registry the agent uses, with a
 * scripted model in place of a paid one — so what is asserted is the real
 * validation, the real service and the real database, with only the model's
 * words supplied by the test.
 */

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(async () => {
  await clearTestDatabase();
  resetJobHandlers();
  resetNotificationProviders();
  registerNotificationProvider(inAppNotificationProvider);
  registerReminderJobs();
});

afterEach(() => {
  setAiProvider(null);
  resetJobHandlers();
  resetNotificationProviders();
});

const signIn = async (timezone = DEFAULT_TIMEZONE) => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id), { timezone });
};

const CONVERSATION = '68b8f0000000000000000001';

describe('the tool registry', () => {
  it('advertises every reminder tool to the model', () => {
    const names = createToolRegistry()
      .definitions()
      .map((definition) => definition.name);

    expect(names).toEqual(
      expect.arrayContaining([
        'create_reminder',
        'list_reminders',
        'get_reminder',
        'update_reminder',
        'cancel_reminder',
      ]),
    );
  });

  it('marks the writing tools as mutating and the reading ones as not', () => {
    const registry = createToolRegistry();

    expect(registry.get('create_reminder')?.mutates).toBe(true);
    expect(registry.get('cancel_reminder')?.mutates).toBe(true);
    expect(registry.get('list_reminders')?.mutates).toBe(false);
    expect(registry.get('get_reminder')?.mutates).toBe(false);
  });
});

describe('create_reminder', () => {
  it('schedules from a local wall clock', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();

    const outcome = await registry.execute(
      'create_reminder',
      { title: 'Billz qarzlarni tekshirish', scheduledAt: '2026-12-01T10:00' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('2026-12-01 10:00 (+05:00)');

    const stored = await ReminderModel.findOne().lean<ReminderDocument | null>().exec();
    expect(stored).toMatchObject({
      title: 'Billz qarzlarni tekshirish',
      status: 'scheduled',
      timezone: DEFAULT_TIMEZONE,
    });
    // The model stated a wall clock; the conversion is the service's, not its.
    expect(stored?.scheduledAt.toISOString()).toBe('2026-12-01T05:00:00.000Z');
    // The conversation it was asked for in is kept as provenance.
    expect(String(stored?.conversation)).toBe(CONVERSATION);
  });

  it('schedules from a delay', async () => {
    const { actor } = await signIn();
    const before = Date.now();

    const outcome = await createToolRegistry().execute(
      'create_reminder',
      { title: "Ta'minotchiga qo'ng'iroq", inMinutes: 120 },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    const stored = await ReminderModel.findOne().lean<ReminderDocument | null>().exec();
    const ahead = (stored?.scheduledAt.getTime() ?? 0) - before;

    expect(ahead).toBeGreaterThan(119 * 60_000);
    expect(ahead).toBeLessThan(121 * 60_000);
  });

  it('builds a standard recurrence rule from structured fields', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'create_reminder',
      {
        title: 'Haftalik savdoni tekshir',
        scheduledAt: '2026-12-07T09:00',
        recurrence: { frequency: 'WEEKLY', interval: 1, byWeekday: ['MO'] },
      },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('Reminder set');
    expect(
      (await ReminderModel.findOne().lean<ReminderDocument | null>().exec())?.recurrenceRule,
    ).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('answers with a question instead of guessing a vague time', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'create_reminder',
      { title: 'Bugun kechqurun eslat', partOfDay: 'evening' },
      { actor, conversationId: CONVERSATION },
    );

    // Not a failure: the model is being told to ask, and a failed call would
    // read to it as something having gone wrong.
    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toMatch(/what time counts as evening/i);
    expect(outcome.result.data).toMatchObject({ needsClarification: true });
    expect(await ReminderModel.countDocuments().exec()).toBe(0);
  });

  it('uses a remembered preference once the user has given one', async () => {
    const { actor } = await signIn();

    await memoryService.remember(actor, {
      type: 'preference',
      key: 'evening_reminder_time',
      value: '19:00',
      source: 'user',
    });

    const outcome = await createToolRegistry().execute(
      'create_reminder',
      { title: 'Kechqurun eslat', partOfDay: 'evening', date: '2026-12-01' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('2026-12-01 19:00 (+05:00)');
  });

  it('rejects arguments that do not match the schema, without writing anything', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'create_reminder',
      { title: 'No time given' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('failed');
    expect(await ReminderModel.countDocuments().exec()).toBe(0);
  });

  it('reports a bad recurrence as a failed call rather than storing it', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'create_reminder',
      {
        title: 'Impossible',
        scheduledAt: '2026-12-01T10:00',
        recurrence: { frequency: 'DAILY', interval: 1, byWeekday: ['MO'] },
      },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('failed');
    expect(await ReminderModel.countDocuments().exec()).toBe(0);
  });
});

describe('list, get, update and cancel', () => {
  const createOne = async (actor: AuthenticatedUser) => {
    const registry = createToolRegistry();

    await registry.execute(
      'create_reminder',
      { title: 'Check the stock', scheduledAt: '2026-12-01T10:00' },
      { actor, conversationId: CONVERSATION },
    );

    const stored = await ReminderModel.findOne().lean<ReminderDocument | null>().exec();

    return { registry, id: String(stored?._id) };
  };

  it('lists the user’s own reminders', async () => {
    const { actor } = await signIn();
    const { registry } = await createOne(actor);

    const outcome = await registry.execute(
      'list_reminders',
      {},
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('Check the stock');
    expect(outcome.result.data).toMatchObject({ total: 1 });
  });

  it('says plainly when there is nothing scheduled', async () => {
    const { actor } = await signIn();

    const outcome = await createToolRegistry().execute(
      'list_reminders',
      {},
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.result.summary).toMatch(/no scheduled reminders/i);
  });

  it('fetches one by id', async () => {
    const { actor } = await signIn();
    const { registry, id } = await createOne(actor);

    const outcome = await registry.execute(
      'get_reminder',
      { reminderId: id },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.data).toMatchObject({ id, title: 'Check the stock' });
  });

  it('moves a reminder', async () => {
    const { actor } = await signIn();
    const { registry, id } = await createOne(actor);

    const outcome = await registry.execute(
      'update_reminder',
      { reminderId: id, scheduledAt: '2026-12-02T16:00', title: 'Check the stock again' },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(await ReminderModel.findById(id).lean<ReminderDocument | null>().exec()).toMatchObject({
      title: 'Check the stock again',
    });
    expect(outcome.result.summary).toContain('2026-12-02 16:00 (+05:00)');
  });

  it('turns a repeating reminder into a one-off', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();

    await registry.execute(
      'create_reminder',
      {
        title: 'Weekly',
        scheduledAt: '2026-12-07T09:00',
        recurrence: { frequency: 'WEEKLY', interval: 1 },
      },
      { actor, conversationId: CONVERSATION },
    );
    const stored = await ReminderModel.findOne().lean<ReminderDocument | null>().exec();

    await registry.execute(
      'update_reminder',
      { reminderId: String(stored?._id), stopRepeating: true },
      { actor, conversationId: CONVERSATION },
    );

    expect(
      (await ReminderModel.findById(stored?._id).lean<ReminderDocument | null>().exec())
        ?.recurrenceRule,
    ).toBeNull();
  });

  it('cancels a reminder so it never fires', async () => {
    const { actor } = await signIn();
    const { registry, id } = await createOne(actor);

    const outcome = await registry.execute(
      'cancel_reminder',
      { reminderId: id },
      { actor, conversationId: CONVERSATION },
    );

    expect(outcome.status).toBe('succeeded');
    expect(outcome.result.summary).toContain('Cancelled');
    expect(await ReminderModel.findById(id).lean<ReminderDocument | null>().exec()).toMatchObject({
      status: 'cancelled',
    });

    await runDueJobs({ now: new Date('2026-12-01T10:00:00Z') });
    expect(await NotificationModel.countDocuments().exec()).toBe(0);
  });

  it('never reaches another employee’s reminder through a tool', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    const { id } = await createOne(owner.actor);
    const registry = createToolRegistry();

    for (const name of ['get_reminder', 'cancel_reminder']) {
      const outcome = await registry.execute(
        name,
        { reminderId: id },
        // The actor comes from the authenticated request, never from the model,
        // so a guessed id is simply not found.
        { actor: stranger.actor, conversationId: CONVERSATION },
      );

      expect(outcome.status).toBe('failed');
      expect(outcome.result.summary).toMatch(/not found/i);
    }

    const list = await registry.execute(
      'list_reminders',
      {},
      { actor: stranger.actor, conversationId: CONVERSATION },
    );

    expect(list.result.data).toMatchObject({ total: 0 });
    expect(await ReminderModel.findById(id).lean<ReminderDocument | null>().exec()).toMatchObject({
      status: 'scheduled',
    });
  });
});

describe('the system prompt', () => {
  it('tells the model the user’s own time and zone', async () => {
    const { actor } = await signIn();

    const prompt = buildSystemPrompt(actor, [], new Date('2026-09-04T05:00:00Z'));

    // Without this the model has no way to resolve "tomorrow" and will invent
    // a date.
    expect(prompt).toContain('2026-09-04 10:00 (+05:00)');
    expect(prompt).toContain('Asia/Tashkent');
    expect(prompt).toMatch(/ask for an exact one rather than guessing/i);
  });
});

describe('through the agent', () => {
  it('sets a reminder the model asked for and confirms it in the reply', async () => {
    const { actor } = await signIn();

    setAiProvider(
      createScriptedProvider([
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-1',
              name: 'create_reminder',
              arguments: {
                title: 'Billz qarzlarni tekshirish',
                scheduledAt: '2026-12-01T10:00',
              },
            },
          ],
        },
        { content: 'Ertaga soat 10:00 da eslataman.' },
      ]),
    );

    const response = await sendMessage(actor, {
      message: 'Ertaga soat 10:00 da Billz qarzlarni tekshirishni eslat',
    });

    expect(response.message.content).toBe('Ertaga soat 10:00 da eslataman.');

    const stored = await ReminderModel.findOne().lean<ReminderDocument | null>().exec();
    expect(stored).toMatchObject({ title: 'Billz qarzlarni tekshirish', status: 'scheduled' });
    // The whole path is real: the reminder is queued, and running the queue
    // delivers it.
    await runDueJobs({ now: new Date('2026-12-01T05:01:00Z') });
    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('cancels a reminder the model found through list_reminders', async () => {
    const { actor } = await signIn();

    await createToolRegistry().execute(
      'create_reminder',
      { title: 'Never mind this', scheduledAt: '2026-12-01T10:00' },
      { actor, conversationId: CONVERSATION },
    );
    const stored = await ReminderModel.findOne().lean<ReminderDocument | null>().exec();

    setAiProvider(
      createScriptedProvider([
        {
          content: '',
          toolCalls: [{ callId: 'call-1', name: 'list_reminders', arguments: {} }],
        },
        {
          content: '',
          toolCalls: [
            {
              callId: 'call-2',
              name: 'cancel_reminder',
              arguments: { reminderId: String(stored?._id) },
            },
          ],
        },
        { content: 'Bekor qildim.' },
      ]),
    );

    const response = await sendMessage(actor, { message: 'Anavi eslatmani bekor qil' });

    expect(response.message.content).toBe('Bekor qildim.');
    expect(
      await ReminderModel.findById(stored?._id).lean<ReminderDocument | null>().exec(),
    ).toMatchObject({ status: 'cancelled' });
  });

  it('asks the user rather than the tool inventing a time', async () => {
    const { actor } = await signIn();

    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-1',
            name: 'create_reminder',
            arguments: { title: 'Bugun kechqurun eslat', partOfDay: 'evening' },
          },
        ],
      },
      { content: 'Kechqurun deganda soat nechani nazarda tutyapsiz?' },
    ]);

    setAiProvider(provider);

    const response = await sendMessage(actor, { message: 'Bugun kechqurun eslat' });

    expect(response.message.content).toMatch(/soat nechani/);
    expect(await ReminderModel.countDocuments().exec()).toBe(0);

    // The question reached the model as the tool's result, so it had something
    // to ask rather than having to invent an hour.
    const lastRequest = provider.requests.at(-1) as
      { messages: Array<{ content: string }> } | undefined;

    expect(
      lastRequest?.messages.some((message) => /what time counts as evening/i.test(message.content)),
    ).toBe(true);
  });
});

describe('scheduler wiring', () => {
  it('registers the reminder handler under the type the tools enqueue', () => {
    resetJobHandlers();
    registerReminderJobs();

    expect(() => registerJobHandler('reminder.deliver', async () => undefined)).toThrow(
      /already registered/,
    );
  });
});
