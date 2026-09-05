/**
 * Where a notification can be delivered.
 *
 * The list is the vocabulary; a channel appearing here does not mean a provider
 * for it is installed. Delivery asks the registry, and an unavailable channel
 * fails the attempt cleanly instead of being silently dropped.
 */
export const NOTIFICATION_CHANNELS = ['in_app', 'telegram', 'email'] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** In-app is always available, so it is what a reminder falls back to. */
export const DEFAULT_NOTIFICATION_CHANNELS: readonly NotificationChannel[] = ['in_app'];

export const NOTIFICATION_STATUSES = ['unread', 'read'] as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** What produced the notification, which decides how a client renders it. */
export const NOTIFICATION_CATEGORIES = ['reminder', 'system', 'alert'] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_TITLE_MAX_LENGTH = 200;
export const NOTIFICATION_BODY_MAX_LENGTH = 2_000;

/** Beyond this the unread badge shows "99+" rather than a real count. */
export const UNREAD_BADGE_LIMIT = 99;
