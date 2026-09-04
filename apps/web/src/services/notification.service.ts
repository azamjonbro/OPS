import type {
  Notification,
  NotificationStatus,
  PaginatedResult,
  UnreadCount,
} from '@hadiya/shared';

import { api } from './http';

export interface ListNotificationsParams {
  page?: number;
  pageSize?: number;
  status?: NotificationStatus;
}

/**
 * The inbox endpoints. Everything is already scoped to the signed-in employee
 * by the API, so the client never sends a user id and cannot ask for anyone
 * else's notifications.
 */
export const notificationService = {
  list: (params: ListNotificationsParams = {}): Promise<PaginatedResult<Notification>> =>
    api.get<PaginatedResult<Notification>>('/v1/notifications', { params }),

  unreadCount: (): Promise<UnreadCount> => api.get<UnreadCount>('/v1/notifications/unread-count'),

  markRead: (id: string): Promise<Notification> =>
    api.post<Notification>(`/v1/notifications/${id}/read`),

  markAllRead: (): Promise<{ updated: number }> =>
    api.post<{ updated: number }>('/v1/notifications/read-all'),

  remove: (id: string): Promise<{ deleted: number }> =>
    api.delete<{ deleted: number }>(`/v1/notifications/${id}`),
};
