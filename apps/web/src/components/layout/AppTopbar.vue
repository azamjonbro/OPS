<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';

import NotificationBell from '@/components/notifications/NotificationBell.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

const route = useRoute();
const auth = useAuthStore();
const ui = useUiStore();

const title = computed(() => route.meta.title ?? 'Hadiya');
const displayName = computed(() => auth.user?.fullName ?? 'Not signed in');
const roleLabel = computed(() => auth.user?.role ?? 'no active session');
</script>

<template>
  <header
    class="flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border-subtle bg-white px-4 sm:px-6"
  >
    <div class="flex items-center gap-3">
      <BaseButton
        variant="ghost"
        size="sm"
        class="lg:hidden"
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
      </BaseButton>
      <h1 class="text-lg font-semibold text-ink-900">{{ title }}</h1>
    </div>

    <div class="flex items-center gap-3">
      <NotificationBell />
      <div class="hidden text-right sm:block">
        <p class="text-sm font-medium text-ink-900">{{ displayName }}</p>
        <p class="text-xs capitalize text-ink-500">{{ roleLabel }}</p>
      </div>
      <span
        class="grid size-9 place-items-center rounded-full bg-surface-muted text-sm font-semibold text-ink-700 ring-1 ring-border-subtle"
        aria-hidden="true"
      >
        {{ auth.user ? auth.user.fullName.charAt(0).toUpperCase() : '?' }}
      </span>
    </div>
  </header>
</template>
