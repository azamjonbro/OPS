<script setup lang="ts">
import { onMounted } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import { useNotificationsStore } from '@/stores/notifications';
import { formatDateTime } from '@/utils/format';

/** The inbox: what has already been delivered, and what is still unread. */
const notifications = useNotificationsStore();

onMounted(() => {
  void notifications.load();
});
</script>

<template>
  <BaseCard title="Notifications" description="Delivered to you in the app">
    <template #header>
      <div class="flex items-center gap-2">
        <BaseButton
          v-if="notifications.hasUnread"
          variant="secondary"
          size="sm"
          @click="notifications.markAllRead()"
        >
          Mark all read
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :loading="notifications.isLoading"
          @click="notifications.load()"
        >
          Refresh
        </BaseButton>
      </div>
    </template>

    <p v-if="notifications.error" class="text-sm text-rose-600">{{ notifications.error }}</p>

    <p
      v-else-if="notifications.notifications.length === 0 && !notifications.isLoading"
      class="text-sm text-ink-500"
    >
      Nothing here yet.
    </p>

    <ul v-else class="divide-y divide-border-subtle rounded-lg ring-1 ring-border-subtle">
      <li
        v-for="notification in notifications.notifications"
        :key="notification.id"
        class="flex items-start justify-between gap-4 px-4 py-3"
        :class="notification.status === 'unread' ? 'bg-brand-50/40' : ''"
      >
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-sm font-medium text-ink-900">
            <span
              v-if="notification.status === 'unread'"
              class="size-2 shrink-0 rounded-full bg-brand-600"
              aria-label="Unread"
            />
            <span class="truncate">{{ notification.title }}</span>
          </p>
          <p class="mt-0.5 truncate text-xs text-ink-500">{{ notification.body }}</p>
          <p class="mt-1 text-xs text-ink-500">{{ formatDateTime(notification.createdAt) }}</p>
        </div>
        <BaseButton
          v-if="notification.status === 'unread'"
          variant="ghost"
          size="sm"
          @click="notifications.markRead(notification.id)"
        >
          Mark read
        </BaseButton>
      </li>
    </ul>
  </BaseCard>
</template>
