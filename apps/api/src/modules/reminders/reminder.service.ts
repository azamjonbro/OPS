import {
  ACTIVE_REMINDER_STATUSES,
  buildPaginationMeta,
  DEFAULT_NOTIFICATION_CHANNELS,
  describeRecurrence,
  formatInTimeZone,
  isObjectIdString,
  nextOccurrence,
  parseRecurrenceRule,
  RecurrenceError,
  REMINDER_DELIVERY_MAX_ATTEMPTS,
  resolvePagination,
  type AuthenticatedUser,
  type NotificationChannel,
  type PaginatedResult,
  type ReminderStatus,
} from '@hadiya/shared';

import { toObjectId, toObjectIdOrNull } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { cancelJobs, enqueueJob } from '../../core/scheduler/index.js';
import * as notificationService from '../notifications/notification.service.js';
import { ReminderModel, type ReminderDocument } from './reminder.model.js';
import { resolveReminderTime, type TimeRequest } from './reminder-time.js';

const log = createLogger('reminders');

/** The job type the scheduler dispatches a due reminder to. */
export const REMINDER_JOB_TYPE = 'reminder.deliver';

/**
 * Reminders, scoped to one person.
 *
 * Every request-facing function takes the actor and filters on their id, so a
 * reminder cannot be read, changed or cancelled across accounts. There is no
 * "fetch then check" anywhere below: the ownership is part of the query, which
 * means a bug can only ever return nothing, never somebody else's row.
 *
 * The scheduler-facing functions at the bottom take no actor, because no user
 * is making the request — they are reached only from a job the process itself
 * enqueued, never from an HTTP route.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

/**
 * One job key per occurrence.
 *
 * The instant is part of the key, so re-enqueuing the same occurrence — after a
 * restart, or because two paths both tried to schedule it — is a no-op, while
 * the *next* occurrence of a repeating reminder is a genuinely new job. This is
 * the mechanism that makes "never delivered twice" a property of the data
 * rather than of careful coding.
 */
export const occurrenceKey = (reminderId: string, scheduledAt: Date): string =>
  `${REMINDER_JOB_TYPE}:${reminderId}:${scheduledAt.getTime()}`;

/** Returns whether a job was actually created, or one already existed. */
const scheduleOccurrence = async (reminder: ReminderDocument): Promise<boolean> => {
  const { created } = await enqueueJob({
    type: REMINDER_JOB_TYPE,
    key: occurrenceKey(String(reminder._id), reminder.scheduledAt),
    payload: {
      reminderId: String(reminder._id),
      // Carried so a stale job — one whose reminder has since been moved — can
      // recognise itself and stand down instead of firing at the old time.
      occurrenceAt: reminder.scheduledAt.toISOString(),
    },
    runAt: reminder.scheduledAt,
    maxAttempts: REMINDER_DELIVERY_MAX_ATTEMPTS,
  });

  return created;
};

/** Drops every outstanding job for a reminder, whatever occurrence it was for. */
const cancelOccurrences = async (reminderId: string): Promise<void> => {
  await cancelJobs({ type: REMINDER_JOB_TYPE, 'payload.reminderId': reminderId });
};

const parseRule = (rule: string | null | undefined): string | null => {
  if (!rule) {
    return null;
  }

  try {
    parseRecurrenceRule(rule);
  } catch (error) {
    throw ApiError.badRequest(
      error instanceof RecurrenceError ? error.message : 'The recurrence rule could not be read',
    );
  }

  return rule;
};

/**
 * Adds the two fields a client would otherwise have to recompute: the rule in
 * plain language, and the instant as its owner set it. Both are derived here
 * because both need the reminder's own zone, which the browser does not have.
 *
 * The response layer turns `_id` and the dates into their wire forms, so what
 * a client receives matches `ReminderView`.
 */
export type ReminderWithDerived = ReminderDocument & {
  recurrenceDescription: string | null;
  localScheduledAt: string;
};

export const toView = (reminder: ReminderDocument): ReminderWithDerived => ({
  ...reminder,
  recurrenceDescription: reminder.recurrenceRule
    ? describeRecurrence(parseRecurrenceRule(reminder.recurrenceRule))
    : null,
  localScheduledAt: formatInTimeZone(reminder.scheduledAt, reminder.timezone),
});

export interface CreateReminderInput extends TimeRequest {
  title: string;
  description?: string | null | undefined;
  /** RFC 5545 rule for a repeating reminder. */
  recurrenceRule?: string | null | undefined;
  channels?: NotificationChannel[] | undefined;
  conversationId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * The clarification a caller gets instead of a guess.
 *
 * Creating is not all-or-nothing: an under-specified time is a question, and
 * the assistant is expected to ask it rather than pick an hour and hope.
 */
export type CreateReminderResult =
  | { outcome: 'created'; reminder: ReminderDocument }
  | { outcome: 'needs_clarification'; question: string };

export const createReminder = async (
  actor: AuthenticatedUser,
  input: CreateReminderInput,
  now: Date = new Date(),
): Promise<CreateReminderResult> => {
  const resolved = await resolveReminderTime(actor, input, now);

  if (!resolved.ok) {
    if (resolved.kind === 'ambiguous') {
      return { outcome: 'needs_clarification', question: resolved.question };
    }

    throw ApiError.badRequest(resolved.message);
  }

  const recurrenceRule = parseRule(input.recurrenceRule);
  const title = input.title.trim();

  if (title.length === 0) {
    throw ApiError.badRequest('A reminder needs a title');
  }

  const created = await ReminderModel.create({
    user: toObjectId(actor.id),
    title,
    description: input.description?.trim() || null,
    scheduledAt: resolved.instant,
    timezone: resolved.timezone,
    status: 'scheduled',
    recurrenceRule,
    channels: input.channels?.length ? input.channels : [...DEFAULT_NOTIFICATION_CHANNELS],
    // Provenance only: an unusable id drops the link rather than failing the
    // save, since where a reminder was asked for is not what makes it valid.
    conversation: isObjectIdString(input.conversationId)
      ? toObjectIdOrNull(input.conversationId)
      : null,
    metadata: input.metadata ?? {},
    lastSentAt: null,
    occurrenceCount: 0,
    failureReason: null,
    cancelledAt: null,
  });

  const reminder = created.toObject<ReminderDocument>();

  await scheduleOccurrence(reminder);

  log.info(
    { reminderId: String(reminder._id), scheduledAt: reminder.scheduledAt, recurrenceRule },
    'reminder scheduled',
  );

  return { outcome: 'created', reminder };
};

export interface ListRemindersQuery {
  page: number;
  pageSize: number;
  status?: ReminderStatus | undefined;
  /** Only reminders due at or after this instant. */
  from?: Date | undefined;
  to?: Date | undefined;
  search?: string | undefined;
}

export const listReminders = async (
  actor: AuthenticatedUser,
  query: ListRemindersQuery,
): Promise<PaginatedResult<ReminderDocument>> => {
  const filter: Record<string, unknown> = ownedBy(actor);

  if (query.status) {
    filter.status = query.status;
  }

  if (query.from || query.to) {
    filter.scheduledAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  if (query.search) {
    filter.$or = [
      { title: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    ReminderModel.find(filter)
      .sort({ scheduledAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean<ReminderDocument[]>()
      .exec(),
    ReminderModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

/** What is coming up, which is what a dashboard and the assistant both ask for. */
export const listUpcoming = async (
  actor: AuthenticatedUser,
  limit: number,
  now: Date = new Date(),
): Promise<ReminderDocument[]> =>
  ReminderModel.find(
    ownedBy(actor, {
      status: { $in: ACTIVE_REMINDER_STATUSES },
      scheduledAt: { $gte: new Date(now.getTime() - 60_000) },
    }),
  )
    .sort({ scheduledAt: 1 })
    .limit(limit)
    .lean<ReminderDocument[]>()
    .exec();

export const getReminder = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ReminderDocument> => {
  const reminder = await ReminderModel.findOne(ownedBy(actor, { _id: id }))
    .lean<ReminderDocument | null>()
    .exec();

  if (!reminder) {
    // Someone else's reminder is reported as missing rather than forbidden: a
    // 403 would confirm that the id exists.
    throw ApiError.notFound('Reminder not found');
  }

  return reminder;
};

export interface UpdateReminderInput extends TimeRequest {
  title?: string | undefined;
  description?: string | null | undefined;
  recurrenceRule?: string | null | undefined;
  channels?: NotificationChannel[] | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export type UpdateReminderResult =
  | { outcome: 'updated'; reminder: ReminderDocument }
  | { outcome: 'needs_clarification'; question: string };

/**
 * Changes a reminder, rescheduling it when the time moved.
 *
 * The old occurrence's job is cancelled before the new one is enqueued, so a
 * moved reminder cannot fire at both times — the keys differ, and without the
 * cancellation the original job would still be sitting in the queue, due.
 */
export const updateReminder = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateReminderInput,
  now: Date = new Date(),
): Promise<UpdateReminderResult> => {
  const existing = await getReminder(actor, id);

  if (existing.status !== 'scheduled') {
    throw ApiError.conflict(`A ${existing.status} reminder cannot be changed`);
  }

  const update: Record<string, unknown> = {};
  const wantsNewTime =
    input.scheduledAt !== undefined ||
    input.inMinutes !== undefined ||
    input.partOfDay !== undefined ||
    input.timezone !== undefined;

  if (wantsNewTime) {
    const resolved = await resolveReminderTime(
      // The reminder's own zone is the default, not the account's: moving a
      // reminder set for another zone should not silently drag it home.
      { ...actor, timezone: input.timezone ?? existing.timezone },
      input,
      now,
    );

    if (!resolved.ok) {
      if (resolved.kind === 'ambiguous') {
        return { outcome: 'needs_clarification', question: resolved.question };
      }

      throw ApiError.badRequest(resolved.message);
    }

    update.scheduledAt = resolved.instant;
    update.timezone = resolved.timezone;
  }

  if (input.title !== undefined) {
    const title = input.title.trim();

    if (title.length === 0) {
      throw ApiError.badRequest('A reminder needs a title');
    }

    update.title = title;
  }

  if (input.description !== undefined) {
    update.description = input.description?.trim() || null;
  }

  if (input.recurrenceRule !== undefined) {
    update.recurrenceRule = parseRule(input.recurrenceRule);
  }

  if (input.channels !== undefined) {
    update.channels =
      input.channels.length > 0 ? input.channels : [...DEFAULT_NOTIFICATION_CHANNELS];
  }

  if (input.metadata !== undefined) {
    update.metadata = input.metadata;
  }

  if (Object.keys(update).length === 0) {
    return { outcome: 'updated', reminder: existing };
  }

  const updated = await ReminderModel.findOneAndUpdate(
    ownedBy(actor, { _id: id, status: 'scheduled' }),
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ReminderDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Reminder not found');
  }

  if (update.scheduledAt) {
    await cancelOccurrences(id);
    await scheduleOccurrence(updated);
  }

  return { outcome: 'updated', reminder: updated };
};

/**
 * Cancels a reminder and everything queued for it.
 *
 * The row survives with a `cancelled` status: a person who wants to know why
 * they were never reminded is better served by a record than by an absence.
 */
export const cancelReminder = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ReminderDocument> => {
  const updated = await ReminderModel.findOneAndUpdate(
    ownedBy(actor, { _id: id, status: 'scheduled' }),
    { $set: { status: 'cancelled', cancelledAt: new Date() } },
    { returnDocument: 'after' },
  )
    .lean<ReminderDocument | null>()
    .exec();

  if (!updated) {
    // Either it does not exist, belongs to somebody else, or has already
    // finished — none of which is a reason to say which.
    const existing = await ReminderModel.findOne(ownedBy(actor, { _id: id }))
      .lean<ReminderDocument | null>()
      .exec();

    if (existing) {
      throw ApiError.conflict(`This reminder is already ${existing.status}`);
    }

    throw ApiError.notFound('Reminder not found');
  }

  await cancelOccurrences(id);

  return updated;
};

/* -------------------------------------------------------------------------- */
/* Scheduler-facing. No actor: nothing below is reachable from a request.      */
/* -------------------------------------------------------------------------- */

/**
 * Works out where a repeating reminder goes next.
 *
 * Two rules, both about not making things worse after an outage. The search
 * starts from the occurrence just delivered, so a slightly late run does not
 * skip a day. But if that next occurrence is *also* already past — the process
 * was down for a week — the search restarts from now, so the person gets their
 * next reminder rather than a week of backdated ones arriving at once.
 */
export const computeNextOccurrence = (reminder: ReminderDocument, now: Date): Date | null => {
  if (!reminder.recurrenceRule) {
    return null;
  }

  const rule = parseRecurrenceRule(reminder.recurrenceRule);
  const shared = {
    rule,
    timeZone: reminder.timezone,
    // The current occurrence is the anchor. That stays correct as the series
    // advances precisely because it is itself an occurrence: everything an
    // interval apart from it is also an interval apart from the original, and
    // the wall-clock time of day travels along with it.
    anchor: reminder.scheduledAt,
    occurrences: reminder.occurrenceCount,
  };

  const following = nextOccurrence({ ...shared, after: reminder.scheduledAt });

  if (!following || following.getTime() > now.getTime()) {
    return following;
  }

  return nextOccurrence({ ...shared, after: now });
};

export interface DeliveryResult {
  status: 'delivered' | 'skipped' | 'failed';
  reason?: string;
  /** Where the reminder goes next, when it repeats. */
  nextOccurrence?: Date | null;
}

/**
 * Delivers one occurrence. Called only by the scheduler.
 *
 * Three guards run before anything is sent, and each one closes a real hole: a
 * reminder that has since been cancelled is not delivered, a job whose
 * occurrence no longer matches the reminder is stale and stands down, and a
 * delivery is keyed on the occurrence so a retry after a partial failure cannot
 * put a second copy in the inbox.
 *
 * A failure is thrown rather than swallowed, because the scheduler is what owns
 * retrying — and once the attempts are spent, the reminder is marked `failed`
 * with the reason, so a message that never arrived is visible instead of silent.
 */
export const deliverOccurrence = async (
  reminderId: string,
  occurrenceAt: Date,
  now: Date = new Date(),
): Promise<DeliveryResult> => {
  const reminder = await ReminderModel.findById(reminderId).lean<ReminderDocument | null>().exec();

  if (!reminder) {
    return { status: 'skipped', reason: 'The reminder no longer exists' };
  }

  if (reminder.status !== 'scheduled') {
    return { status: 'skipped', reason: `The reminder is ${reminder.status}` };
  }

  if (reminder.scheduledAt.getTime() !== occurrenceAt.getTime()) {
    // The reminder was moved after this job was queued; the job for the new
    // time is the one that should fire.
    return { status: 'skipped', reason: 'The reminder was rescheduled' };
  }

  const report = await notificationService.deliver(reminder.channels, {
    userId: String(reminder.user),
    category: 'reminder',
    title: reminder.title,
    body: reminder.description ?? reminder.title,
    reminderId: String(reminder._id),
    metadata: {
      ...reminder.metadata,
      scheduledAt: reminder.scheduledAt.toISOString(),
      timezone: reminder.timezone,
    },
    // The same key the job carries, so the notification is idempotent for
    // exactly as long as the job is.
    dedupeKey: occurrenceKey(String(reminder._id), reminder.scheduledAt),
  });

  if (!report.delivered) {
    const reason = notificationService.describeFailure(report);

    // Thrown, not returned: the scheduler is what decides whether there is
    // another attempt left.
    throw new Error(`No channel accepted the reminder (${reason})`);
  }

  const occurrenceCount = reminder.occurrenceCount + 1;
  const next = computeNextOccurrence({ ...reminder, occurrenceCount }, now);

  await ReminderModel.updateOne(
    { _id: reminder._id },
    {
      $set: {
        lastSentAt: now,
        occurrenceCount,
        failureReason: null,
        ...(next
          ? { scheduledAt: next, status: 'scheduled' }
          : { status: 'sent' as ReminderStatus }),
      },
    },
  ).exec();

  if (next) {
    // Queued only after the row has moved on, so the new job and the row agree
    // about which occurrence is next even if the process dies between them.
    await scheduleOccurrence({ ...reminder, scheduledAt: next, occurrenceCount });
  }

  log.info({ reminderId, occurrenceAt, next, channels: reminder.channels }, 'reminder delivered');

  return { status: 'delivered', nextOccurrence: next };
};

/** Records that delivery was abandoned, once the scheduler has given up. */
export const markDeliveryFailed = async (reminderId: string, reason: string): Promise<void> => {
  await ReminderModel.updateOne(
    { _id: reminderId, status: 'scheduled' },
    { $set: { status: 'failed', failureReason: reason.slice(0, 500) } },
  ).exec();
};

/**
 * Re-queues reminders whose job is missing.
 *
 * Nothing should normally need this — a job outlives the process that made it —
 * but a database restored from a backup, or a row written while the queue was
 * unreachable, would otherwise leave a reminder that is `scheduled` forever and
 * never fires. Enqueuing is keyed by occurrence, so a reminder that *does* have
 * its job is untouched.
 */
export const recoverPendingReminders = async (now: Date = new Date()): Promise<number> => {
  const horizon = new Date(now.getTime() + 86_400_000);
  const due = await ReminderModel.find({
    status: 'scheduled',
    scheduledAt: { $lte: horizon },
  })
    .limit(500)
    .lean<ReminderDocument[]>()
    .exec();

  let recovered = 0;

  for (const reminder of due) {
    // Only a genuine insert counts: a reminder that already has its job is the
    // normal case and re-queuing it is a no-op, not a recovery.
    if (await scheduleOccurrence(reminder)) {
      recovered += 1;
    }
  }

  if (recovered > 0) {
    log.info({ recovered }, 'reminders re-queued after start-up');
  }

  return recovered;
};
