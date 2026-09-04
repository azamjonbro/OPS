import type {
  NotificationCategory,
  NotificationChannel,
  NotificationStatus,
} from '../constants/notifications.js';
import type { Entity } from './entity.js';

/** One delivered message in a person's inbox. */
export interface Notification extends Entity {
  user: string;
  category: NotificationCategory;
  title: string;
  body: string;
  status: NotificationStatus;
  channel: NotificationChannel;
  /** Reminder that produced it, when there was one. */
  reminder: string | null;
  /** Free-form context carried through from the source. */
  metadata: Record<string, unknown>;
  /** ISO-8601, set when the owner marked it read. */
  readAt: string | null;
}

export interface UnreadCount {
  unread: number;
}
