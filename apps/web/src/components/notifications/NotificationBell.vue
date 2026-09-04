<script setup lang="ts">
import { UNREAD_BADGE_LIMIT } from '@hadiya/shared';
import { computed, onMounted } from 'vue';

import { useNotificationsStore } from '@/stores/notifications';

/**
 * The unread badge in the topbar. It reads the count endpoint rather than the
 * list, so it stays cheap enough to sit on every screen.
 */
const notifications = useNotificationsStore();

const label = computed(() =>
  notifications.unread > UNREAD_BADGE_LIMIT
    ? `${UNREAD_BADGE_LIMIT}+`
    : String(notifications.unread),
);

onMounted(() => {
  void notifications.refreshUnread();
});
</script>

<template>
  <RouterLink
    :to="{ name: 'reminders' }"
    class="relative grid size-9 place-items-center rounded-full text-ink-700 ring-1 ring-border-subtle hover:bg-surface-muted"
    :aria-label="`Notifications${notifications.hasUnread ? `, ${label} unread` : ''}`"
  >
    <svg
      class="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
    </svg>
    <span
      v-if="notifications.hasUnread"
      class="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-semibold text-white"
    >
      {{ label }}
    </span>
  </RouterLink>
</template>
