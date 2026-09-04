import type { NotificationChannel } from '../constants/notifications.js';
import type { ReminderStatus } from '../constants/reminders.js';
import type { Entity } from './entity.js';

/**
 * Something a person asked to be reminded of.
 *
 * `scheduledAt` is an instant in UTC and `timezone` is the wall clock it was
 * meant in. Both are stored, and neither can be derived from the other: the
 * instant is what the scheduler fires on, and the zone is what a repeat is
 * rebuilt against so nine in the morning stays nine in the morning across a
 * daylight-saving change.
 */
export interface Reminder extends Entity {
  /** Owner. Reminders are never shared and never visible across accounts. */
  user: string;
  title: string;
  description: string | null;
  /** ISO-8601 UTC instant of the next (or only) occurrence. */
  scheduledAt: string;
  /** IANA zone name, e.g. `Asia/Tashkent`. */
  timezone: string;
  status: ReminderStatus;
  /** RFC 5545 rule, e.g. `FREQ=WEEKLY;BYDAY=MO`, or `null` for a one-off. */
  recurrenceRule: string | null;
  /** Where it should be delivered, in order of preference. */
  channels: NotificationChannel[];
  /** Conversation it was asked for in, when it came from a chat. */
  conversation: string | null;
  /** Free-form context from whoever created it; never interpreted by the API. */
  metadata: Record<string, unknown>;
  /** ISO-8601 of the last successful delivery. */
  lastSentAt: string | null;
  /** Deliveries completed so far, which is what COUNT is measured against. */
  occurrenceCount: number;
  /** Why a `failed` reminder gave up. */
  failureReason: string | null;
  /** ISO-8601, set when a person cancelled it. */
  cancelledAt: string | null;
}

/** A reminder plus the derived fields a client would otherwise recompute. */
export interface ReminderView extends Reminder {
  /** Plain-language recurrence, e.g. `Every week on Monday`. */
  recurrenceDescription: string | null;
  /** `2026-09-05 10:00 (+05:00)` — the reminder as its owner set it. */
  localScheduledAt: string;
}
