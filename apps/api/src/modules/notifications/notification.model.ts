import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_STATUSES,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One message in a person's inbox.
 *
 * `dedupeKey` is what makes delivery safe to retry. A reminder that fires,
 * stores its notification and then fails while updating its own row will be
 * retried by the scheduler; without the key that retry would leave a second
 * copy in the inbox. With it, the insert simply loses to the unique index and
 * the delivery is recognised as already done.
 */
export interface NotificationDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  category: NotificationCategory;
  title: string;
  body: string;
  status: NotificationStatus;
  channel: NotificationChannel;
  reminder: Types.ObjectId | null;
  metadata: Record<string, unknown>;
  dedupeKey: string | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = createSchema<NotificationDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  category: { type: String, required: true, enum: NOTIFICATION_CATEGORIES },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  body: { type: String, required: true, trim: true, maxlength: 2_000 },
  status: { type: String, required: true, enum: NOTIFICATION_STATUSES, default: 'unread' },
  channel: { type: String, required: true, enum: NOTIFICATION_CHANNELS, default: 'in_app' },
  reminder: { type: Schema.Types.ObjectId, ref: 'Reminder', default: null },
  metadata: { type: Schema.Types.Mixed, required: true, default: {} },
  dedupeKey: { type: String, default: null, maxlength: 200 },
  readAt: { type: Date, default: null },
});

/**
 * One notification per delivery, enforced by the database. The partial filter
 * keeps the constraint off notifications created without a key (a direct system
 * message), which would otherwise all collide on `null`.
 */
notificationSchema.index(
  { user: 1, channel: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);
// The inbox read: this user's notifications, newest first, optionally unread.
notificationSchema.index({ user: 1, status: 1, createdAt: -1 });

export const NotificationModel: Model<NotificationDocument> = model<NotificationDocument>(
  'Notification',
  notificationSchema,
);
