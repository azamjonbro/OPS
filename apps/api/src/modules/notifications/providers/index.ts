import { inAppNotificationProvider } from './in-app.provider.js';
import { registerNotificationProvider } from './notification-provider.js';
import { telegramNotificationProvider } from './telegram.provider.js';

/**
 * Installs the providers the process ships with. Called once at start-up, and
 * again by tests that need a clean registry.
 */
export const registerDefaultNotificationProviders = (): void => {
  registerNotificationProvider(inAppNotificationProvider);
  registerNotificationProvider(telegramNotificationProvider);
};

export { inAppNotificationProvider } from './in-app.provider.js';
export { telegramNotificationProvider } from './telegram.provider.js';
export {
  availableChannels,
  getNotificationProvider,
  registerNotificationProvider,
  resetNotificationProviders,
  type DeliveryOutcome,
  type NotificationMessage,
  type NotificationProvider,
} from './notification-provider.js';
