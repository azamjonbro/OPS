import { DEFAULT_TIMEZONE, SCHEDULED_JOB_MAX_ATTEMPTS } from '@hadiya/shared';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import {
  registerJobHandler,
  resetJobHandlers,
  runDueJobs,
  ScheduledJobModel,
  type ScheduledJobDocument,
} from '../../core/scheduler/index.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { NotificationModel } from '../notifications/notification.model.js';
import {
  registerNotificationProvider,
  resetNotificationProviders,
  type NotificationProvider,
} from '../notifications/providers/index.js';
import { inAppNotificationProvider } from '../notifications/providers/in-app.provider.js';
import * as memoryService from '../memory/memory.service.js';
import { ReminderModel, type ReminderDocument } from './reminder.model.js';
import { registerReminderJobs } from './reminder.jobs.js';
import * as reminderService from './reminder.service.js';

/**
 * Reminders end to end, with a real database and a controlled clock.
 *
 * Nothing here waits for a reminder to come due: the scheduler is driven with
 * the instant to evaluate, so "next Monday at nine" is exercised by handing it
 * next Monday. Delivery goes through the real provider registry with the
 * in-app channel installed, so what the tests assert on is what production
 * writes.
 */

const app = createApp();
const url = '/api/v1/reminders';

/** A Friday, 09:00 in Tashkent (04:00 UTC). */
const NOW = new Date('2026-09-04T04:00:00Z');
const at = (offsetMs: number): Date => new Date(NOW.getTime() + offsetMs);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
  resetJobHandlers();
  resetNotificationProviders();
});

const signIn = async (timezone = DEFAULT_TIMEZONE) => {
  const branch = await createTestBranch();

  return signInAs(app, 'manager', String(branch._id), { timezone });
};

const jobsFor = (reminderId: string): Promise<ScheduledJobDocument[]> =>
  ScheduledJobModel.find({ 'payload.reminderId': reminderId })
    .sort({ runAt: 1 })
    .lean<ScheduledJobDocument[]>()
    .exec();

const reload = async (id: string): Promise<ReminderDocument> => {
  const reminder = await ReminderModel.findById(id).lean<ReminderDocument | null>().exec();

  if (!reminder) {
    throw new Error(`Reminder ${id} disappeared`);
  }

  return reminder;
};

describe(`POST ${url}`, () => {
  it('creates a one-time reminder and queues exactly one job for it', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Billz qarzlarni tekshirish', scheduledAt: '2026-12-01T10:00' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      title: 'Billz qarzlarni tekshirish',
      status: 'scheduled',
      timezone: DEFAULT_TIMEZONE,
      recurrenceRule: null,
      channels: ['in_app'],
      localScheduledAt: '2026-12-01 10:00 (+05:00)',
    });

    const jobs = await jobsFor(response.body.data.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ type: 'reminder.deliver', status: 'pending' });
  });

  it('reads the stated time in the user’s zone, not in UTC', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Ertaga soat 10 da', scheduledAt: '2026-12-01T10:00' });

    // 10:00 in Tashkent is 05:00 UTC. Storing the digits as UTC would fire it
    // five hours early, and nothing about the record would look wrong.
    expect(response.body.data.scheduledAt).toBe('2026-12-01T05:00:00.000Z');
  });

  it('honours a zone the user does not live in', async () => {
    const { authorization } = await signIn();

    const response = await request(app).post(url).set('Authorization', authorization).send({
      title: 'Call Berlin',
      scheduledAt: '2026-12-01T10:00',
      timezone: 'Europe/Berlin',
    });

    expect(response.body.data.scheduledAt).toBe('2026-12-01T09:00:00.000Z');
    expect(response.body.data.timezone).toBe('Europe/Berlin');
  });

  it('accepts a relative time', async () => {
    const { actor } = await signIn();

    const result = await reminderService.createReminder(
      actor,
      { title: "Ta'minotchiga qo'ng'iroq qilish", inMinutes: 120 },
      NOW,
    );

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.reminder.scheduledAt.toISOString()).toBe(at(2 * HOUR).toISOString());
  });

  it('asks for an exact time instead of guessing what “evening” means', async () => {
    const { actor } = await signIn();

    const result = await reminderService.createReminder(
      actor,
      { title: 'Bugun kechqurun eslat', partOfDay: 'evening' },
      NOW,
    );

    expect(result.outcome).toBe('needs_clarification');
    if (result.outcome !== 'needs_clarification') return;
    expect(result.question).toMatch(/what time counts as evening/i);
    expect(await ReminderModel.countDocuments().exec()).toBe(0);
  });

  it('uses a part of the day once the user has told us what it means', async () => {
    const { actor } = await signIn();

    // The preference is a Phase 5 memory, stated by the person themselves.
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'evening_reminder_time',
      value: '19:00',
      source: 'user',
    });

    const result = await reminderService.createReminder(
      actor,
      { title: 'Bugun kechqurun eslat', partOfDay: 'evening' },
      NOW,
    );

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    // 19:00 in Tashkent on the same local day, which is 14:00 UTC.
    expect(result.reminder.scheduledAt.toISOString()).toBe('2026-09-04T14:00:00.000Z');
  });

  it('asks for a time when only a date was given', async () => {
    const { actor } = await signIn();

    const result = await reminderService.createReminder(
      actor,
      { title: 'Juma kuni', scheduledAt: '2026-12-01' },
      NOW,
    );

    expect(result.outcome).toBe('needs_clarification');
    if (result.outcome !== 'needs_clarification') return;
    expect(result.question).toMatch(/what time/i);
  });

  it('refuses a time in the past and an unknown zone', async () => {
    const { authorization } = await signIn();

    const past = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Yesterday', scheduledAt: '2020-01-01T10:00' });

    expect(past.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(past.body.error.message).toMatch(/in the past/i);

    const zone = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Nowhere', scheduledAt: '2026-12-01T10:00', timezone: 'Asia/Tashkant' });

    expect(zone.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('refuses a recurrence rule it cannot honour', async () => {
    const { authorization } = await signIn();

    const response = await request(app).post(url).set('Authorization', authorization).send({
      title: 'Yearly',
      scheduledAt: '2026-12-01T10:00',
      recurrenceRule: 'FREQ=YEARLY',
    });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(await ReminderModel.countDocuments().exec()).toBe(0);
  });
});

describe(`GET ${url}`, () => {
  it('lists a user’s own reminders, soonest first', async () => {
    const { authorization } = await signIn();

    for (const [title, when] of [
      ['Later', '2026-12-05T10:00'],
      ['Sooner', '2026-12-01T10:00'],
    ]) {
      await request(app)
        .post(url)
        .set('Authorization', authorization)
        .send({ title, scheduledAt: when });
    }

    const response = await request(app).get(url).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items.map((item: { title: string }) => item.title)).toEqual([
      'Sooner',
      'Later',
    ]);
  });

  it('retrieves one reminder with its recurrence in plain language', async () => {
    const { authorization } = await signIn();
    const created = await request(app).post(url).set('Authorization', authorization).send({
      title: 'Haftalik savdo',
      scheduledAt: '2026-12-07T09:00',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
    });

    const response = await request(app)
      .get(`${url}/${created.body.data.id}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      title: 'Haftalik savdo',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      recurrenceDescription: 'Every week on Monday',
    });
  });
});

describe(`PATCH ${url}/:id`, () => {
  it('moves a reminder and cancels the job for the old time', async () => {
    const { authorization } = await signIn();
    const created = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Move me', scheduledAt: '2026-12-01T10:00' });
    const id = created.body.data.id;

    const response = await request(app)
      .patch(`${url}/${id}`)
      .set('Authorization', authorization)
      .send({ title: 'Moved', scheduledAt: '2026-12-02T15:30' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      title: 'Moved',
      localScheduledAt: '2026-12-02 15:30 (+05:00)',
    });

    const jobs = await jobsFor(id);
    // Both occurrences have a row, but only the new one is still live: without
    // the cancellation the reminder would fire at both times.
    expect(jobs.filter((job) => job.status === 'pending')).toHaveLength(1);
    expect(jobs.filter((job) => job.status === 'cancelled')).toHaveLength(1);
  });

  it('changes wording without rescheduling', async () => {
    const { authorization } = await signIn();
    const created = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Original', scheduledAt: '2026-12-01T10:00' });

    await request(app)
      .patch(`${url}/${created.body.data.id}`)
      .set('Authorization', authorization)
      .send({ description: 'with detail' });

    const jobs = await jobsFor(created.body.data.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.status).toBe('pending');
  });

  it('refuses to change a reminder that has already finished', async () => {
    const { authorization, actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Done', inMinutes: 5 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');

    await reminderService.cancelReminder(actor, String(created.reminder._id));

    const response = await request(app)
      .patch(`${url}/${String(created.reminder._id)}`)
      .set('Authorization', authorization)
      .send({ title: 'Too late' });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });
});

describe(`cancelling`, () => {
  it('stops the reminder and every job queued for it', async () => {
    const { authorization } = await signIn();
    const created = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Never mind', scheduledAt: '2026-12-01T10:00' });
    const id = created.body.data.id;

    const response = await request(app)
      .post(`${url}/${id}/cancel`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.status).toBe('cancelled');
    expect((await jobsFor(id)).every((job) => job.status === 'cancelled')).toBe(true);
  });

  it('reports a second cancellation as a conflict rather than pretending', async () => {
    const { authorization } = await signIn();
    const created = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ title: 'Once', scheduledAt: '2026-12-01T10:00' });

    await request(app)
      .post(`${url}/${created.body.data.id}/cancel`)
      .set('Authorization', authorization);
    const second = await request(app)
      .post(`${url}/${created.body.data.id}/cancel`)
      .set('Authorization', authorization);

    expect(second.status).toBe(HTTP_STATUS.CONFLICT);
  });
});

describe('user isolation', () => {
  it('never lets one employee see, change or cancel another’s reminders', async () => {
    const owner = await signIn();
    const stranger = await signIn();

    const created = await request(app)
      .post(url)
      .set('Authorization', owner.authorization)
      .send({ title: 'Private', scheduledAt: '2026-12-01T10:00' });
    const id = created.body.data.id;

    const list = await request(app).get(url).set('Authorization', stranger.authorization);
    expect(list.body.data.items).toHaveLength(0);

    // A 404 rather than a 403: a 403 would confirm the id exists.
    for (const response of [
      await request(app).get(`${url}/${id}`).set('Authorization', stranger.authorization),
      await request(app)
        .patch(`${url}/${id}`)
        .set('Authorization', stranger.authorization)
        .send({ title: 'Hijacked' }),
      await request(app).post(`${url}/${id}/cancel`).set('Authorization', stranger.authorization),
    ]) {
      expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    }

    expect(await reload(id)).toMatchObject({ title: 'Private', status: 'scheduled' });
  });

  it('refuses an unauthenticated request', async () => {
    const response = await request(app).get(url);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('delivery', () => {
  it('delivers a due reminder once and marks it sent', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Ring the supplier', inMinutes: 60 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    // Nothing happens before it is due.
    expect(await runDueJobs({ now: NOW })).toMatchObject({ claimed: 0 });
    expect(await NotificationModel.countDocuments().exec()).toBe(0);

    expect(await runDueJobs({ now: at(61 * MINUTE) })).toMatchObject({ succeeded: 1 });

    const notifications = await NotificationModel.find().lean().exec();
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({
      category: 'reminder',
      title: 'Ring the supplier',
      status: 'unread',
      channel: 'in_app',
    });
    expect(await reload(id)).toMatchObject({ status: 'sent', occurrenceCount: 1 });
  });

  it('delivers work that came due while the process was down', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'While you were out', inMinutes: 30 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');

    // The job outlived the process that made it, so a pass a day later still
    // finds it — this is the restart guarantee, stated as a row in a table.
    expect(await runDueJobs({ now: at(DAY) })).toMatchObject({ succeeded: 1 });
    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('never delivers the same occurrence twice', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Once', inMinutes: 5 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);
    const occurrence = created.reminder.scheduledAt;

    await runDueJobs({ now: at(6 * MINUTE) });

    // A job for the same occurrence is re-queued — the shape of a duplicate
    // delivery, whether from a retry, a second worker or a recovery sweep.
    await reminderService.recoverPendingReminders(at(7 * MINUTE));
    await runDueJobs({ now: at(8 * MINUTE) });

    // And the guard below that: the delivery itself is keyed, so even a
    // successful second run could not write a second notification.
    await reminderService.deliverOccurrence(id, occurrence, at(9 * MINUTE));

    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('does not fire at the old time after a reminder has been moved', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Moved', inMinutes: 30 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);
    const originalOccurrence = created.reminder.scheduledAt;

    await reminderService.updateReminder(actor, id, { inMinutes: 300 }, NOW);

    // The stale job stands down even if something runs it anyway.
    const outcome = await reminderService.deliverOccurrence(
      id,
      originalOccurrence,
      at(31 * MINUTE),
    );

    expect(outcome).toMatchObject({ status: 'skipped', reason: 'The reminder was rescheduled' });
    expect(await NotificationModel.countDocuments().exec()).toBe(0);
  });

  it('does not deliver a cancelled reminder', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Cancelled', inMinutes: 5 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');

    await reminderService.cancelReminder(actor, String(created.reminder._id));
    await runDueJobs({ now: at(10 * MINUTE) });

    expect(await NotificationModel.countDocuments().exec()).toBe(0);
  });
});

describe('recurring delivery', () => {
  it('rolls a weekly reminder forward and queues the next occurrence', async () => {
    const { actor } = await signIn();
    // Monday 7 September 2026, 09:00 Tashkent.
    const created = await reminderService.createReminder(
      actor,
      {
        title: 'Haftalik savdoni tekshir',
        scheduledAt: '2026-09-07T09:00',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    await runDueJobs({ now: new Date('2026-09-07T04:01:00Z') });

    const afterFirst = await reload(id);
    expect(afterFirst).toMatchObject({ status: 'scheduled', occurrenceCount: 1 });
    // Still 09:00 locally, a week later — not "168 hours after the last one".
    expect(afterFirst.scheduledAt.toISOString()).toBe('2026-09-14T04:00:00.000Z');
    expect((await jobsFor(id)).filter((job) => job.status === 'pending')).toHaveLength(1);

    await runDueJobs({ now: new Date('2026-09-14T04:01:00Z') });

    expect(await reload(id)).toMatchObject({ occurrenceCount: 2, status: 'scheduled' });
    expect(await NotificationModel.countDocuments().exec()).toBe(2);
  });

  it('stops a counted series once it has run its course', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      {
        title: 'Twice only',
        scheduledAt: '2026-09-05T09:00',
        recurrenceRule: 'FREQ=DAILY;COUNT=2',
      },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    await runDueJobs({ now: new Date('2026-09-05T04:01:00Z') });
    expect(await reload(id)).toMatchObject({ status: 'scheduled', occurrenceCount: 1 });

    await runDueJobs({ now: new Date('2026-09-06T04:01:00Z') });
    const finished = await reload(id);

    expect(finished).toMatchObject({ status: 'sent', occurrenceCount: 2 });
    expect(await NotificationModel.countDocuments().exec()).toBe(2);
  });

  it('skips ahead rather than firing a week of backdated reminders at once', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Daily', scheduledAt: '2026-09-05T09:00', recurrenceRule: 'FREQ=DAILY' },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    // The process was down for a week; the first pass back runs one delivery.
    await runDueJobs({ now: new Date('2026-09-12T04:01:00Z') });

    const after = await reload(id);
    expect(await NotificationModel.countDocuments().exec()).toBe(1);
    // The next occurrence is ahead of the catch-up run, not behind it.
    expect(after.scheduledAt.getTime()).toBeGreaterThan(new Date('2026-09-12T04:01:00Z').getTime());
    expect(after.scheduledAt.toISOString()).toBe('2026-09-13T04:00:00.000Z');
  });

  it('keeps the local hour across a daylight-saving change', async () => {
    const { actor } = await signIn('Europe/Berlin');
    const created = await reminderService.createReminder(
      actor,
      {
        title: 'Weekly standup',
        // Monday 23 March 2026, 09:00 Berlin — a week before the clocks move.
        scheduledAt: '2026-03-23T09:00',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      },
      new Date('2026-03-20T09:00:00Z'),
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    expect(created.reminder.scheduledAt.toISOString()).toBe('2026-03-23T08:00:00.000Z');

    await runDueJobs({ now: new Date('2026-03-23T08:01:00Z') });

    // 09:00 Berlin is 07:00 UTC once summer time starts. A fixed seven-day
    // addition would have produced 08:00 UTC — ten o'clock, an hour late.
    expect((await reload(id)).scheduledAt.toISOString()).toBe('2026-03-30T07:00:00.000Z');
  });
});

describe('failed delivery', () => {
  /** A channel that is registered and available, and always refuses. */
  const brokenProvider: NotificationProvider = {
    channel: 'in_app',
    isAvailable: () => true,
    deliver: async () => {
      throw new Error('inbox is unreachable');
    },
  };

  it('retries, then records the failure on the reminder itself', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Doomed', inMinutes: 5 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    resetNotificationProviders();
    registerNotificationProvider(brokenProvider);

    const first = await runDueJobs({ now: at(6 * MINUTE) });
    expect(first).toMatchObject({ retried: 1, failed: 0 });
    // Still scheduled: an attempt that will be retried is not a failure yet.
    expect(await reload(id)).toMatchObject({ status: 'scheduled', failureReason: null });

    for (let attempt = 1; attempt < SCHEDULED_JOB_MAX_ATTEMPTS; attempt += 1) {
      await runDueJobs({ now: at((attempt + 1) * DAY) });
    }

    const abandoned = await reload(id);
    expect(abandoned.status).toBe('failed');
    expect(abandoned.failureReason).toMatch(/inbox is unreachable/);
    expect(await NotificationModel.countDocuments().exec()).toBe(0);
  });

  it('succeeds on a retry once the channel comes back', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Flaky', inMinutes: 5 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');

    resetNotificationProviders();
    registerNotificationProvider(brokenProvider);
    await runDueJobs({ now: at(6 * MINUTE) });

    resetNotificationProviders();
    registerNotificationProvider(inAppNotificationProvider);
    await runDueJobs({ now: at(DAY) });

    expect(await reload(String(created.reminder._id))).toMatchObject({ status: 'sent' });
    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('fails a reminder whose only channel has no provider at all', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Telegram only', inMinutes: 5, channels: ['telegram'] },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');

    await expect(
      reminderService.deliverOccurrence(
        String(created.reminder._id),
        created.reminder.scheduledAt,
        at(6 * MINUTE),
      ),
    ).rejects.toThrow(/No channel accepted/);
  });
});

describe('recovery', () => {
  it('re-queues a scheduled reminder whose job was lost', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Orphan', inMinutes: 30 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');
    const id = String(created.reminder._id);

    // Simulates a queue restored without its jobs — a backup, or a write that
    // never reached the collection.
    await ScheduledJobModel.deleteMany({}).exec();
    expect(await jobsFor(id)).toHaveLength(0);

    expect(await reminderService.recoverPendingReminders(NOW)).toBe(1);
    await runDueJobs({ now: at(31 * MINUTE) });

    expect(await NotificationModel.countDocuments().exec()).toBe(1);
  });

  it('leaves a reminder that still has its job alone', async () => {
    const { actor } = await signIn();
    const created = await reminderService.createReminder(
      actor,
      { title: 'Intact', inMinutes: 30 },
      NOW,
    );
    if (created.outcome !== 'created') throw new Error('setup failed');

    await reminderService.recoverPendingReminders(NOW);

    expect(await jobsFor(String(created.reminder._id))).toHaveLength(1);
  });
});

describe('job payloads', () => {
  it('refuses a malformed job without burning retries on it', async () => {
    resetJobHandlers();
    registerReminderJobs();

    // Registered by hand so the payload is wrong in exactly one way.
    await ScheduledJobModel.create({
      type: 'reminder.deliver',
      key: 'reminder.deliver:broken',
      payload: { reminderId: 'not-an-id' },
      runAt: NOW,
      status: 'pending',
      attempts: 0,
      maxAttempts: 3,
    });

    expect(await runDueJobs({ now: at(MINUTE) })).toMatchObject({ failed: 1, retried: 0 });
  });

  it('registers exactly one handler for the reminder job type', () => {
    resetJobHandlers();
    registerReminderJobs();

    expect(() => registerJobHandler('reminder.deliver', async () => undefined)).toThrow(
      /already registered/,
    );
  });
});
