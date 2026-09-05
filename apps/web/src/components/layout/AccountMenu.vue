<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';

import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import DropdownItem from '@/components/ui/DropdownItem.vue';
import { usePermissions } from '@/composables/usePermissions';
import { useAuthStore } from '@/stores/auth';
import { useBranchesStore } from '@/stores/branches';
import { useUiStore } from '@/stores/ui';

/**
 * Who is signed in, the theme, and the way out.
 *
 * Extracted from the topbar because the chat has a top bar of its own and the
 * account menu is the same thing in both — two copies would be two places for
 * "sign out" to stop clearing the branch store.
 */
const router = useRouter();
const auth = useAuthStore();
const ui = useUiStore();
const branches = useBranchesStore();
const { role } = usePermissions();

const THEME_LABELS = { light: 'Light', dark: 'Dark', system: 'System' } as const;

const displayName = computed(() => auth.user?.fullName ?? 'Not signed in');
const initial = computed(() => auth.user?.fullName?.charAt(0).toUpperCase() ?? '?');

const signOut = async (): Promise<void> => {
  await auth.logout();
  branches.reset();
  await router.push({ name: 'login' });
};
</script>

<template>
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
      v-for="option in ['light', 'dark', 'system'] as const"
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
</template>
