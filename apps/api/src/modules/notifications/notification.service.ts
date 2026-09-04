import {
  buildPaginationMeta,
  resolvePagination,
  type AuthenticatedUser,
  type NotificationChannel,
  type NotificationStatus,
  type PaginatedResult,
} from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { NotificationModel, type NotificationDocument } from './notification.model.js';
import {
  getNotificationProvider,
  type NotificationMessage,
} from './providers/notification-provider.js';

const log = createLogger('notifications');

/**
 * A person's inbox, and the one way anything gets into it.
 *
 * Every read and write here filters on the actor's id. That filter *is* the
 * authorisation: a query that cannot match another account's row cannot leak
 * it, which is stronger than reading a document and then deciding whether the
 * caller should have seen it.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

export interface ChannelDelivery {
  channel: NotificationChannel;
  status: 'delivered' | 'duplicate' | 'skipped' | 'failed';
  notificationId?: string;
  reason?: string;
}

export interface DeliveryReport {
  /** True when at least one channel accepted the message. */
  delivered: boolean;
  results: ChannelDelivery[];
}

/**
 * Sends one message over the requested channels.
 *
 * Each channel is tried in turn and the outcome of every one is recorded, so a
 * message that reached the inbox but not Telegram is distinguishable from one
 * that reached nobody. An unavailable channel is skipped rather than treated as
 * a failure — it never had a chance — but if *nothing* was delivered the caller
 * is told, and the scheduler turns that into a retry and eventually into a
 * visible failure. A notification that silently went nowhere is the one outcome
 * this must never produce.
 */
export const deliver = async (
  channels: readonly NotificationChannel[],
  message: NotificationMessage,
): Promise<DeliveryReport> => {
  const results: ChannelDelivery[] = [];

  for (const channel of channels) {
    const provider = getNotificationProvider(channel);

    if (!provider) {
      results.push({ channel, status: 'skipped', reason: 'No provider is registered' });
      continue;
    }

    if (!provider.isAvailable()) {
      results.push({ channel, status: 'skipped', reason: `${channel} is not available` });
      continue;
    }

    try {
      const outcome = await provider.deliver(message);

      results.push({
        channel,
        status: outcome.duplicate ? 'duplicate' : 'delivered',
        ...(outcome.notificationId ? { notificationId: outcome.notificationId } : {}),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      log.warn({ channel, err: error }, 'notification delivery failed');
      results.push({ channel, status: 'failed', reason });
    }
  }

  return {
    // A duplicate counts as delivered: the person has the message, which is the
    // only thing the caller actually wanted.
    delivered: results.some(
      (entry) => entry.status === 'delivered' || entry.status === 'duplicate',
    ),
    results,
  };
};

/** Why nothing arrived, in one line, for a failure record a person will read. */
export const describeFailure = (report: DeliveryReport): string =>
  report.results.map((entry) => `${entry.channel}: ${entry.reason ?? entry.status}`).join('; ') ||
  'no channel was attempted';

export interface ListNotificationsQuery {
  page: number;
  pageSize: number;
  status?: NotificationStatus | undefined;
}

export const listNotifications = async (
  actor: AuthenticatedUser,
  query: ListNotificationsQuery,
): Promise<PaginatedResult<NotificationDocument>> => {
  const filter = ownedBy(actor, query.status ? { status: query.status } : {});
  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    NotificationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<NotificationDocument[]>()
      .exec(),
    NotificationModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const countUnread = async (actor: AuthenticatedUser): Promise<number> =>
  NotificationModel.countDocuments(ownedBy(actor, { status: 'unread' })).exec();

export const getNotification = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<NotificationDocument> => {
  const notification = await NotificationModel.findOne(ownedBy(actor, { _id: id }))
    .lean<NotificationDocument | null>()
    .exec();

  if (!notification) {
    // Someone else's notification is reported as missing, not forbidden: a 403
    // would confirm the id exists.
    throw ApiError.notFound('Notification not found');
  }

  return notification;
};

export const markRead = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<NotificationDocument> => {
  const updated = await NotificationModel.findOneAndUpdate(
    ownedBy(actor, { _id: id }),
    { $set: { status: 'read', readAt: new Date() } },
    { returnDocument: 'after' },
  )
    .lean<NotificationDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Notification not found');
  }

  return updated;
};

export const markAllRead = async (actor: AuthenticatedUser): Promise<{ updated: number }> => {
  const result = await NotificationModel.updateMany(ownedBy(actor, { status: 'unread' }), {
    $set: { status: 'read', readAt: new Date() },
  }).exec();

  return { updated: result.modifiedCount };
};

export const removeNotification = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<{ deleted: number }> => {
  const result = await NotificationModel.deleteOne(ownedBy(actor, { _id: id })).exec();

  if (result.deletedCount === 0) {
    throw ApiError.notFound('Notification not found');
  }

  return { deleted: result.deletedCount };
};
