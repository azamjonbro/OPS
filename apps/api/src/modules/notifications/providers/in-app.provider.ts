import { toObjectId, toObjectIdOrNull } from '../../../core/db/object-id.js';
import { NotificationModel, type NotificationDocument } from '../notification.model.js';
import type {
  DeliveryOutcome,
  NotificationMessage,
  NotificationProvider,
} from './notification-provider.js';

/** MongoDB's duplicate-key error. */
const DUPLICATE_KEY = 11000;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY;

/**
 * The in-app inbox: the one channel that is always available, because it needs
 * no third party to be up and no credential to be configured.
 *
 * Delivery is a single insert guarded by a unique key, so it is idempotent by
 * construction: a retry after a partial failure finds its own earlier row and
 * reports the delivery as already done instead of writing a second copy.
 */
export const inAppNotificationProvider: NotificationProvider = {
  channel: 'in_app',

  isAvailable: () => true,

  deliver: async (message: NotificationMessage): Promise<DeliveryOutcome> => {
    try {
      const created = await NotificationModel.create({
        user: toObjectId(message.userId),
        category: message.category,
        title: message.title,
        body: message.body,
        status: 'unread',
        channel: 'in_app',
        reminder: toObjectIdOrNull(message.reminderId ?? null),
        metadata: message.metadata ?? {},
        dedupeKey: message.dedupeKey ?? null,
        readAt: null,
      });

      return { notificationId: String(created._id), duplicate: false };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const existing = await NotificationModel.findOne({
        user: toObjectId(message.userId),
        channel: 'in_app',
        dedupeKey: message.dedupeKey,
      })
        .lean<NotificationDocument | null>()
        .exec();

      return { notificationId: existing ? String(existing._id) : null, duplicate: true };
    }
  },
};
