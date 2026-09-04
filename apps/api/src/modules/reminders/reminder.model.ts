import {
  DEFAULT_NOTIFICATION_CHANNELS,
  NOTIFICATION_CHANNELS,
  REMINDER_STATUSES,
  type NotificationChannel,
  type ReminderStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * Something a person asked to be reminded of.
 *
 * Two time fields, and both are load-bearing. `scheduledAt` is a UTC instant —
 * the only representation that cannot be misread, and the one the scheduler
 * compares against. `timezone` is the wall clock the person meant it in, kept
 * because it cannot be recovered from the instant: a weekly reminder has to be
 * rebuilt as "09:00 next Monday in Tashkent", not as "168 hours later", or it
 * drifts by an hour every time a daylight-saving rule changes.
 *
 * A repeating reminder is one row, not a row per occurrence: after each
 * delivery `scheduledAt` advances to the next occurrence and the status stays
 * `scheduled`. That keeps "cancel this reminder" a single, obvious write.
 */
export interface ReminderDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: string;
  description: string | null;
  /** UTC instant of the next (or only) occurrence. */
  scheduledAt: Date;
  /** IANA zone name the wall-clock time was stated in. */
  timezone: string;
  status: ReminderStatus;
  /** RFC 5545 rule, e.g. `FREQ=WEEKLY;BYDAY=MO`, or `null` for a one-off. */
  recurrenceRule: string | null;
  channels: NotificationChannel[];
  conversation: Types.ObjectId | null;
  metadata: Record<string, unknown>;
  lastSentAt: Date | null;
  /** Deliveries completed, which is what an RRULE `COUNT` is measured against. */
  occurrenceCount: number;
  failureReason: string | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const reminderSchema = createSchema<ReminderDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: null, trim: true, maxlength: 2_000 },
  scheduledAt: { type: Date, required: true },
  timezone: { type: String, required: true, trim: true, maxlength: 64 },
  status: { type: String, required: true, enum: REMINDER_STATUSES, default: 'scheduled' },
  recurrenceRule: { type: String, default: null, trim: true, maxlength: 200 },
  channels: {
    type: [{ type: String, enum: NOTIFICATION_CHANNELS }],
    required: true,
    default: () => [...DEFAULT_NOTIFICATION_CHANNELS],
  },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
  metadata: { type: Schema.Types.Mixed, required: true, default: {} },
  lastSentAt: { type: Date, default: null },
  occurrenceCount: { type: Number, required: true, default: 0, min: 0 },
  failureReason: { type: String, default: null, maxlength: 500 },
  cancelledAt: { type: Date, default: null },
});

// The list every screen and every tool asks for: this user's reminders, soonest
// first. Scoping by `user` is what keeps them private.
reminderSchema.index({ user: 1, status: 1, scheduledAt: 1 });
// Sweeping for reminders whose job was lost, independent of who owns them.
reminderSchema.index({ status: 1, scheduledAt: 1 });

export const ReminderModel: Model<ReminderDocument> = model<ReminderDocument>(
  'Reminder',
  reminderSchema,
);
