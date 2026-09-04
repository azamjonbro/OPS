import type { NotificationCategory, NotificationChannel } from '@hadiya/shared';

/**
 * The seam between "something happened" and "the person was told".
 *
 * The reminder service knows nothing about Telegram, e-mail or web sockets: it
 * asks for a message to be delivered on some channels and the registry decides
 * what that means. Adding a channel is registering a provider, with no edit to
 * any of the code that produces notifications.
 */
export interface NotificationMessage {
  /** Recipient. Providers never choose an audience; the caller does. */
  userId: string;
  category: NotificationCategory;
  title: string;
  body: string;
  reminderId?: string | null;
  metadata?: Record<string, unknown>;
  /**
   * Stable identity for this delivery, so a retried attempt is recognised
   * rather than repeated. Two calls with the same key deliver once.
   */
  dedupeKey?: string | null;
}

export interface DeliveryOutcome {
  /** Id of the stored notification, for channels that keep one. */
  notificationId: string | null;
  /** True when this exact delivery had already happened. */
  duplicate: boolean;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  /**
   * Whether the channel can be used right now. A provider with no credentials
   * says so here rather than failing at delivery, so the reason a message did
   * not arrive is legible.
   */
  isAvailable: () => boolean;
  /** Throws on failure; the scheduler turns that into a retry. */
  deliver: (message: NotificationMessage) => Promise<DeliveryOutcome>;
}

const providers = new Map<NotificationChannel, NotificationProvider>();

export const registerNotificationProvider = (provider: NotificationProvider): void => {
  providers.set(provider.channel, provider);
};

export const getNotificationProvider = (
  channel: NotificationChannel,
): NotificationProvider | undefined => providers.get(channel);

export const availableChannels = (): NotificationChannel[] =>
  [...providers.values()].filter((provider) => provider.isAvailable()).map((p) => p.channel);

/** Testing seam: lets a suite install a provider that fails on demand. */
export const resetNotificationProviders = (): void => {
  providers.clear();
};
