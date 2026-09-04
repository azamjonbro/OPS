import { config } from '../../../config/index.js';
import type {
  DeliveryOutcome,
  NotificationMessage,
  NotificationProvider,
} from './notification-provider.js';

/**
 * Telegram, declared but not yet wired.
 *
 * It is here to keep the seam honest: the channel exists in the vocabulary, a
 * provider answers for it, and nothing in the reminder or scheduler code had to
 * learn what Telegram is. Sending needs two things Hadiya does not have yet — a
 * bot token and a chat id per employee — so the provider reports itself
 * unavailable and delivery skips it with a recorded reason rather than
 * pretending to have sent something.
 *
 * Finishing it is one file: keep `isAvailable` honest, and post to the Bot API
 * in `deliver`.
 */
export const telegramNotificationProvider: NotificationProvider = {
  channel: 'telegram',

  isAvailable: () => false,

  deliver: async (_message: NotificationMessage): Promise<DeliveryOutcome> => {
    throw new Error(
      config.integrations.telegram.configured
        ? 'Telegram delivery is not implemented yet: no chat id is linked to this account'
        : 'Telegram is not configured (TELEGRAM_BOT_TOKEN is unset)',
    );
  },
};
