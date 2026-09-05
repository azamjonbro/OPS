<script setup lang="ts">
import { UNREAD_BADGE_LIMIT } from '@hadiya/shared';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

import BusinessAlertCard from './BusinessAlertCard.vue';
import { useAlertsStore } from '@/stores/alerts';
import { useNotificationsStore } from '@/stores/notifications';

/**
 * The bell, and what is behind it.
 *
 * Two lists rather than one, because they answer different questions: alerts
 * are *conditions that are still true* and can be acknowledged, while
 * notifications are *things that happened* and can only be read. Flattening
 * them into one feed would mean a refilled shelf still sitting in the list next
 * to a reminder from Tuesday.
 *
 * The panel is a plain popover rather than a route: an alert is something you
 * glance at mid-conversation, and sending somebody to another page to read it
 * is how they stop reading them.
 */
const notifications = useNotificationsStore();
const alerts = useAlertsStore();

const isOpen = ref(false);
const tab = ref<'alerts' | 'inbox'>('alerts');
const container = ref<HTMLElement | null>(null);

const total = computed(() => alerts.activeCount + notifications.unread);
const badge = computed(() =>
  total.value > UNREAD_BADGE_LIMIT ? `${UNREAD_BADGE_LIMIT}+` : String(total.value),
);

const label = computed(() => {
  if (total.value === 0) {
    return 'Notifications';
  }

  return `Notifications, ${alerts.activeCount} open alert(s) and ${notifications.unread} unread`;
});

const refresh = async (): Promise<void> => {
  await Promise.all([alerts.refreshSummary(), notifications.refreshUnread()]);
};

/** Only the counts are polled; the lists load when the panel is opened. */
onMounted(() => {
  void refresh();
});

watch(isOpen, (open) => {
  if (open) {
    void alerts.load();
    void notifications.load();
  }
});

const onPointerDown = (event: MouseEvent): void => {
  if (isOpen.value && !container.value?.contains(event.target as Node)) {
    isOpen.value = false;
  }
};

const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    isOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener('mousedown', onPointerDown);
  document.addEventListener('keydown', onKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', onPointerDown);
  document.removeEventListener('keydown', onKeydown);
});
</script>

<template>
  <div ref="container" class="relative">
    <button
      type="button"
      class="relative grid size-9 touch-manipulation place-items-center rounded-full text-ink-700 ring-1 ring-border-subtle hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-500"
      :aria-label="label"
      :aria-expanded="isOpen"
      aria-haspopup="dialog"
      @click="isOpen = !isOpen"
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
        v-if="total > 0"
        class="absolute -right-1 -top-1 grid min-w-5 place-items-center rounded-full px-1 text-[10px] font-semibold text-white"
        :class="alerts.hasCritical ? 'bg-danger-600' : 'bg-brand-600'"
      >
        {{ badge }}
      </span>
    </button>

    <div
      v-if="isOpen"
      class="absolute right-0 z-50 mt-2 flex max-h-[70vh] w-[min(24rem,calc(100vw-2rem))] flex-col rounded-[16px] bg-surface shadow-lg ring-1 ring-border-subtle"
      role="dialog"
      aria-label="Notifications"
    >
      <div class="flex items-center gap-1 border-b border-border-subtle p-2">
        <button
          v-for="entry in ['alerts', 'inbox'] as const"
          :key="entry"
          type="button"
          class="rounded-full px-3 py-1.5 text-[12px] font-medium capitalize focus:outline-none focus:ring-2 focus:ring-brand-500"
          :class="
            tab === entry ? 'bg-surface-muted text-ink-900' : 'text-ink-500 hover:text-ink-900'
          "
          :aria-pressed="tab === entry"
          @click="tab = entry"
        >
          {{ entry }}
          <span v-if="entry === 'alerts' && alerts.activeCount > 0"
            >({{ alerts.activeCount }})</span
          >
          <span v-else-if="entry === 'inbox' && notifications.unread > 0">
            ({{ notifications.unread }})
          </span>
        </button>

        <button
          v-if="tab === 'inbox' && notifications.hasUnread"
          type="button"
          class="ml-auto rounded-full px-2 py-1 text-[11px] font-medium text-brand-600 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-500"
          @click="notifications.markAllRead()"
        >
          Mark all read
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-3">
        <template v-if="tab === 'alerts'">
          <p
            v-if="alerts.isLoading"
            class="px-1 py-6 text-center text-[12px] text-ink-500"
            role="status"
          >
            Loading…
          </p>
          <p
            v-else-if="alerts.alerts.length === 0"
            class="px-1 py-6 text-center text-[12px] text-ink-500"
          >
            Hammasi joyida — ochiq alert yo‘q.
          </p>
          <div v-else class="flex flex-col gap-2">
            <BusinessAlertCard
              v-for="alert in alerts.alerts"
              :key="alert.id"
              :alert="alert"
              @acknowledge="alerts.acknowledge"
              @dismiss="alerts.dismiss"
            />
          </div>
        </template>

        <template v-else>
          <p
            v-if="notifications.isLoading"
            class="px-1 py-6 text-center text-[12px] text-ink-500"
            role="status"
          >
            Loading…
          </p>
          <p
            v-else-if="notifications.notifications.length === 0"
            class="px-1 py-6 text-center text-[12px] text-ink-500"
          >
            Hech narsa yo‘q.
          </p>
          <ul v-else class="flex flex-col gap-1">
            <li
              v-for="entry in notifications.notifications"
              :key="entry.id"
              class="rounded-[12px] p-3"
              :class="entry.status === 'unread' ? 'bg-surface-muted' : ''"
            >
              <div class="flex items-start gap-2">
                <!-- A dot *and* a weight change: unread is not carried by colour alone. -->
                <span
                  v-if="entry.status === 'unread'"
                  class="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-600"
                  aria-hidden="true"
                />
                <div class="min-w-0 flex-1">
                  <p
                    class="text-[13px] text-ink-900"
                    :class="entry.status === 'unread' ? 'font-semibold' : 'font-medium'"
                  >
                    {{ entry.title }}
                  </p>
                  <p class="mt-0.5 text-[12px] leading-relaxed text-ink-500">{{ entry.body }}</p>
                </div>
                <button
                  v-if="entry.status === 'unread'"
                  type="button"
                  class="shrink-0 rounded px-1.5 py-0.5 text-[11px] text-ink-400 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  :aria-label="`Mark &quot;${entry.title}&quot; as read`"
                  @click="notifications.markRead(entry.id)"
                >
                  Read
                </button>
              </div>
            </li>
          </ul>
        </template>
      </div>
    </div>
  </div>
</template>
