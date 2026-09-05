<script setup lang="ts">
import { computed, ref } from 'vue';

import { RouterLink } from 'vue-router';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useNavigation } from '@/composables/useNavigation';
import { usePermissions } from '@/composables/usePermissions';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { api } from '@/services/http';
import { useAuthStore } from '@/stores/auth';
import { useUiStore } from '@/stores/ui';

/**
 * The back office: everything that is not the conversation.
 *
 * Hadiya answers questions and does the work; these screens exist for the times
 * somebody needs to read a record directly or correct one by hand. Gathering
 * them here rather than spreading them across a menu is the point — the chat is
 * the product, and a sidebar of twenty modules competing with it says otherwise.
 *
 * The time zone is a server-side account setting — reminders are scheduled
 * against it — so it is saved through the API. The theme is a property of this
 * browser and stays in local storage; sending it to the server would make a
 * shared till fight with a phone over which one is right.
 */
const auth = useAuthStore();
const ui = useUiStore();
const toast = useToast();
const { role } = usePermissions();
// The same list the sidebar renders, filtered to this employee's role, so the
// hub and the menu can never disagree about what exists.
const { sections } = useNavigation();

const timezone = ref(auth.user?.timezone ?? 'Asia/Tashkent');
const isSaving = ref(false);

/** Zones the browser knows, so the list cannot offer one the API would reject. */
const timezoneOptions = computed(() => {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : ['Asia/Tashkent', 'UTC', 'Europe/Moscow', 'Europe/Berlin'];

  return zones.map((zone) => ({ value: zone, label: zone }));
});

const saveTimezone = async (): Promise<void> => {
  if (isSaving.value) {
    return;
  }

  isSaving.value = true;

  try {
    await api.patch('/v1/users/me/preferences', { timezone: timezone.value });
    await auth.refreshUser();
    toast.success('Time zone saved.');
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <div class="mx-auto flex max-w-2xl flex-col gap-5">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Settings</h2>
      <p class="mt-1 text-sm text-ink-500">
        The records behind the assistant, and how this browser presents them.
      </p>
    </div>

    <BaseCard
      v-for="section in sections"
      :key="section.title"
      :title="section.title"
      class="scroll-mt-6"
    >
      <ul class="grid gap-2 sm:grid-cols-2">
        <li v-for="item in section.items" :key="item.label">
          <RouterLink
            v-if="item.to"
            :to="item.to"
            class="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-900 ring-1 ring-border-subtle transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-600"
          >
            <svg
              class="size-4 shrink-0 text-ink-500"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="item.icon" />
            </svg>
            {{ item.label }}
          </RouterLink>

          <span
            v-else
            aria-disabled="true"
            class="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-ink-400 ring-1 ring-border-subtle"
            title="Available in a later phase"
          >
            <svg
              class="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="item.icon" />
            </svg>
            {{ item.label }}
          </span>
        </li>
      </ul>
    </BaseCard>

    <BaseCard title="Account">
      <dl class="grid gap-4 sm:grid-cols-2">
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-500">Name</dt>
          <dd class="mt-1 text-sm font-medium text-ink-900">{{ auth.user?.fullName ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-500">Username</dt>
          <dd class="mt-1 text-sm text-ink-900">{{ auth.user?.username ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-500">Role</dt>
          <dd class="mt-1 text-sm capitalize text-ink-900">{{ role ?? '—' }}</dd>
        </div>
        <div>
          <dt class="text-xs uppercase tracking-wide text-ink-500">Branch</dt>
          <dd class="mt-1 text-sm text-ink-900">
            {{ auth.user?.branch ? 'Assigned to one branch' : 'Organisation-wide' }}
          </dd>
        </div>
      </dl>
    </BaseCard>

    <BaseCard
      title="Time zone"
      description="Reminders are scheduled against this, so it belongs to your account"
    >
      <div class="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex-1">
          <BaseSelect v-model="timezone" label="Zone" :options="timezoneOptions" />
        </div>
        <BaseButton :loading="isSaving" @click="saveTimezone">Save</BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="Appearance" description="Stored in this browser only">
      <BaseSelect
        :model-value="ui.theme"
        label="Theme"
        :options="[
          { value: 'system', label: 'Match the system' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]"
        @update:model-value="(value) => ui.setTheme(value as 'light' | 'dark' | 'system')"
      />
    </BaseCard>
  </div>
</template>
