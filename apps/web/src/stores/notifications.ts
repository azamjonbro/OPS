import type { Notification } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import { notificationService } from '@/services/notification.service';

/**
 * The inbox, and the badge that goes with it.
 *
 * The count is tracked separately from the list because it is what the topbar
 * shows on every screen: refreshing a number is cheap, and pulling the whole
 * list to find out whether the badge should be lit would not be.
 */
export const useNotificationsStore = defineStore('notifications', () => {
  const notifications = ref<Notification[]>([]);
  const unread = ref(0);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  const hasUnread = computed(() => unread.value > 0);

  const run = async <TResult>(action: () => Promise<TResult>): Promise<TResult | null> => {
    error.value = null;

    try {
      return await action();
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    }
  };

  const refreshUnread = async (): Promise<void> => {
    const result = await run(() => notificationService.unreadCount());

    if (result) {
      unread.value = result.unread;
    }
  };

  const load = async (): Promise<void> => {
    isLoading.value = true;

    try {
      const result = await run(() => notificationService.list({ pageSize: 20 }));

      if (result) {
        notifications.value = result.items;
        unread.value = result.items.filter((entry) => entry.status === 'unread').length;
        // The list is one page, so the badge is re-read rather than inferred
        // from what happened to fit on it.
        await refreshUnread();
      }
    } finally {
      isLoading.value = false;
    }
  };

  const markRead = async (id: string): Promise<void> => {
    const updated = await run(() => notificationService.markRead(id));

    if (updated) {
      notifications.value = notifications.value.map((entry) => (entry.id === id ? updated : entry));
      unread.value = Math.max(0, unread.value - 1);
    }
  };

  const markAllRead = async (): Promise<void> => {
    const result = await run(() => notificationService.markAllRead());

    if (result) {
      notifications.value = notifications.value.map((entry) =>
        entry.status === 'unread'
          ? { ...entry, status: 'read', readAt: new Date().toISOString() }
          : entry,
      );
      unread.value = 0;
    }
  };

  const remove = async (id: string): Promise<void> => {
    const result = await run(() => notificationService.remove(id));

    if (result) {
      const removed = notifications.value.find((entry) => entry.id === id);

      notifications.value = notifications.value.filter((entry) => entry.id !== id);

      if (removed?.status === 'unread') {
        unread.value = Math.max(0, unread.value - 1);
      }
    }
  };

  const reset = (): void => {
    notifications.value = [];
    unread.value = 0;
    error.value = null;
  };

  return {
    notifications,
    unread,
    hasUnread,
    isLoading,
    error,
    load,
    refreshUnread,
    markRead,
    markAllRead,
    remove,
    reset,
  };
});
