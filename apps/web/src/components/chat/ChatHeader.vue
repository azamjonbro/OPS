<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { computed } from 'vue';

import AccountMenu from '@/components/layout/AccountMenu.vue';
import BranchSelector from '@/components/layout/BranchSelector.vue';
import NotificationBell from '@/components/notifications/NotificationBell.vue';
import { useUiStore } from '@/stores/ui';

/**
 * The bar above the transcript.
 *
 * It carries the same three things every screen does — branch, notifications,
 * account — because the chat is a screen of the same application and not a
 * separate product. What it adds is the conversation's own title, so somebody
 * with four threads open across tabs can tell which one they are in.
 *
 * The hamburger drives the same `ui` flag the rest of the application uses, so
 * one store decides whether a drawer is open no matter which layout is mounted.
 */
const props = defineProps<{ conversation: Conversation | null; connected: boolean }>();

const ui = useUiStore();

const title = computed(() => props.conversation?.title ?? 'New conversation');
</script>

<template>
  <header
    class="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 sm:px-6"
  >
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="rounded-lg p-2 text-ink-700 hover:bg-surface-muted lg:hidden"
        aria-label="Open conversations"
        @click="ui.toggleMobileSidebar(true)"
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
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div class="min-w-0">
        <p class="text-[0.6875rem] font-medium uppercase tracking-wider text-ink-400">
          Hadiya assistant
        </p>
        <h1 class="truncate text-base font-semibold text-ink-900">{{ title }}</h1>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <!-- Only shown when it is a problem: a green "all well" badge on every
           screen is noise, but somebody typing into an assistant that cannot
           answer deserves to be told before they press Enter. -->
      <span
        v-if="!connected"
        class="hidden items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-xs font-medium text-warning-700 ring-1 ring-inset ring-warning-600/30 sm:inline-flex"
      >
        <span class="size-1.5 rounded-full bg-warning-600" aria-hidden="true" />
        Assistant unavailable
      </span>

      <BranchSelector />
      <NotificationBell />
      <AccountMenu />
    </div>
  </header>
</template>
