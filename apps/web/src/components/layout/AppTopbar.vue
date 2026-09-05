<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import AccountMenu from '@/components/layout/AccountMenu.vue';
import AppBreadcrumbs from '@/components/layout/AppBreadcrumbs.vue';
import BranchSelector from '@/components/layout/BranchSelector.vue';
import NotificationBell from '@/components/notifications/NotificationBell.vue';
import { useUiStore } from '@/stores/ui';

const route = useRoute();
const ui = useUiStore();

const title = computed(() => route.meta.title ?? 'Hadiya');
</script>

<template>
  <header
    class="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-surface px-4 sm:px-6"
  >
    <div class="flex min-w-0 items-center gap-3">
      <button
        type="button"
        class="rounded-lg p-2 text-ink-700 hover:bg-surface-muted lg:hidden"
        aria-label="Open navigation"
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
        <AppBreadcrumbs />
        <h1 class="truncate text-base font-semibold text-ink-900 sm:text-lg">{{ title }}</h1>
      </div>
    </div>

    <div class="flex shrink-0 items-center gap-2 sm:gap-3">
      <BranchSelector />
      <NotificationBell />
      <AccountMenu />
    </div>
  </header>
</template>
