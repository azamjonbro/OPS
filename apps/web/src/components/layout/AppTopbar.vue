<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import AppBreadcrumbs from '@/components/layout/AppBreadcrumbs.vue';
import BranchSelector from '@/components/layout/BranchSelector.vue';
import NotificationBell from '@/components/notifications/NotificationBell.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import DropdownItem from '@/components/ui/DropdownItem.vue';
import { usePermissions } from '@/composables/usePermissions';
import { useAuthStore } from '@/stores/auth';
import { useBranchesStore } from '@/stores/branches';
import { useUiStore } from '@/stores/ui';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();
const branches = useBranchesStore();
const { role } = usePermissions();

const title = computed(() => route.meta.title ?? 'Hadiya');
const displayName = computed(() => auth.user?.fullName ?? 'Not signed in');
const initial = computed(() => auth.user?.fullName?.charAt(0).toUpperCase() ?? '?');

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' } as const;

const signOut = async (): Promise<void> => {
  await auth.logout();
  branches.reset();
  await router.push({ name: 'login' });
};
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

      <BaseDropdown label="Account menu">
        <template #trigger>
          <span class="flex items-center gap-2 rounded-lg p-1 hover:bg-surface-muted">
            <span class="hidden text-right sm:block">
              <span class="block text-sm font-medium text-ink-900">{{ displayName }}</span>
              <span class="block text-xs capitalize text-ink-500">{{ role ?? 'no session' }}</span>
            </span>
            <span
              class="grid size-9 place-items-center rounded-full bg-surface-muted text-sm font-semibold text-ink-700 ring-1 ring-border-subtle"
              aria-hidden="true"
            >
              {{ initial }}
            </span>
          </span>
        </template>

        <div class="border-b border-border-subtle px-3 py-2 sm:hidden">
          <p class="text-sm font-medium text-ink-900">{{ displayName }}</p>
          <p class="text-xs capitalize text-ink-500">{{ role ?? 'no session' }}</p>
        </div>

        <p class="px-3 pb-1 pt-2 text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-400">
          Theme
        </p>
        <DropdownItem
          v-for="option in (['light', 'dark', 'system'] as const)"
          :key="option"
          @click="ui.setTheme(option)"
        >
          <span
            class="size-1.5 rounded-full"
            :class="ui.theme === option ? 'bg-brand-600' : 'bg-transparent'"
            aria-hidden="true"
          />
          {{ THEME_LABELS[option] }}
        </DropdownItem>

        <div class="my-1 border-t border-border-subtle" />

        <DropdownItem @click="router.push({ name: 'settings' })">Settings</DropdownItem>
        <DropdownItem danger @click="signOut">Sign out</DropdownItem>
      </BaseDropdown>
    </div>
  </header>
</template>
