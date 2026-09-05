<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { computed } from 'vue';

import AccountMenu from '@/components/layout/AccountMenu.vue';
import BranchSelector from '@/components/layout/BranchSelector.vue';
import NotificationCenter from '@/components/notifications/NotificationCenter.vue';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{ conversation: Conversation | null; connected: boolean }>();

const ui = useUiStore();

const title = computed(() => props.conversation?.title ?? 'New conversation');
</script>

<template>
  <header
    class="sticky top-0 z-10 flex h-14 shrink-0 items-center justify-between gap-3 bg-surface/80 backdrop-blur-md px-4 sm:px-6 border-b border-border-subtle"
  >
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="rounded-lg p-1.5 text-ink-500 hover:bg-surface-raised hover:text-ink-900 lg:hidden transition-colors"
        aria-label="Open conversations"
        @click="ui.toggleMobileSidebar(true)"
      >
        <svg
          class="size-[20px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div class="min-w-0 flex items-center gap-2">
        <h1 class="truncate text-[14px] font-medium text-ink-900">{{ title }}</h1>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <span
        v-if="!connected"
        class="hidden items-center gap-1.5 rounded-full bg-warning-50 px-2.5 py-1 text-[11px] font-medium text-warning-700 ring-1 ring-inset ring-warning-600/30 sm:inline-flex"
      >
        <span class="size-1.5 rounded-full bg-warning-600" aria-hidden="true" />
        Assistant unavailable
      </span>

      <BranchSelector />
      <NotificationCenter />
      <AccountMenu />
    </div>
  </header>
</template>
