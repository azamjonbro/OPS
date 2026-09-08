<script setup lang="ts">
import type { Integration, IntegrationHealth } from '@hadiya/shared';
import { computed, onMounted, reactive, ref } from 'vue';
import { RouterLink } from 'vue-router';

import IntegrationStatusBadge from '@/components/integrations/IntegrationStatusBadge.vue';
import { PROVIDER_ICONS, PROVIDER_TINTS } from '@/components/integrations/provider-marks';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import { useToast } from '@/composables/useToast';
import { useIntegrationsStore } from '@/stores/integrations';

/**
 * The four things a person does to a connection they already have: check it,
 * switch it, replace its credential, stop it.
 *
 * These live in Settings rather than only on the hub because that is where
 * somebody goes when mail stopped arriving or the assistant stopped answering
 * about Notion — and the first useful act is pressing "check" and reading what
 * comes back. The hub keeps the fuller view: tool permissions, activity, delete.
 *
 * "Stop" and the switch are not the same act, which is why both are here.
 * Stopping drops the connection and forgets the stored credential; the switch
 * only makes Hadiya stop using an integration that stays set up. Merging them
 * would mean the quickest way to pause something also threw the password away.
 */
const store = useIntegrationsStore();
const toast = useToast();

/** Which row has its credential form open, and what has been typed into it. */
const editing = ref<string | null>(null);
const form = reactive({ secret: '', email: '' });

/** The verdict of the last check, per integration, so rows do not share one. */
const health = reactive<Record<string, IntegrationHealth>>({});
const busyId = ref<string | null>(null);

onMounted(() => {
  if (!store.hasAny) {
    void store.load();
  }
});

const rows = computed(() => store.integrations);

const isBusy = (id: string): boolean => busyId.value === id;

const check = async (item: Integration): Promise<void> => {
  busyId.value = item.id;

  const result = await store.test(item.id);

  busyId.value = null;

  if (result) {
    health[item.id] = result;
  }
};

const toggle = async (item: Integration): Promise<void> => {
  busyId.value = item.id;
  await store.update(item.id, { enabled: !item.enabled });
  busyId.value = null;
};

const stop = async (item: Integration): Promise<void> => {
  busyId.value = item.id;
  await store.disconnect(item.id);
  busyId.value = null;
  delete health[item.id];
};

const startEditing = (item: Integration): void => {
  editing.value = item.id;
  form.secret = '';
  form.email = '';
};

const cancelEditing = (): void => {
  editing.value = null;
  form.secret = '';
  form.email = '';
};

const needsEmail = (item: Integration): boolean => item.provider === 'icloud_mail';

const saveCredential = async (item: Integration): Promise<void> => {
  busyId.value = item.id;

  const updated = await store.update(item.id, {
    secret: form.secret.trim(),
    ...(needsEmail(item) && form.email.trim()
      ? { options: { email: form.email.trim().toLowerCase() } }
      : {}),
  });

  busyId.value = null;

  if (updated) {
    cancelEditing();
    toast.success('Saved. Press “Check” to prove the new credential works.');
  }
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <p v-if="store.error" class="text-sm text-danger-700">{{ store.error }}</p>

    <p v-if="rows.length === 0 && !store.isLoading" class="text-sm text-ink-500">
      Nothing is connected yet.
      <RouterLink :to="{ name: 'integration-hub' }" class="text-brand-700 underline">
        Connect iCloud Mail, Notion or your own server
      </RouterLink>
      to see its controls here.
    </p>

    <div
      v-for="item in rows"
      :key="item.id"
      class="flex flex-col gap-3 rounded-lg p-3 ring-1 ring-border-subtle"
    >
      <div class="flex flex-wrap items-center gap-3">
        <span
          class="flex size-8 shrink-0 items-center justify-center rounded-lg"
          :class="PROVIDER_TINTS[item.provider]"
        >
          <svg
            class="size-4"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="PROVIDER_ICONS[item.provider]" />
          </svg>
        </span>

        <div class="min-w-0 flex-1">
          <RouterLink
            :to="{ name: 'integration', params: { id: item.id } }"
            class="text-sm font-medium text-ink-900 hover:underline"
          >
            {{ item.name }}
          </RouterLink>
          <p class="truncate text-xs text-ink-500">
            {{ health[item.id]?.message ?? item.lastError ?? 'No check has been run yet.' }}
          </p>
        </div>

        <IntegrationStatusBadge :status="item.status" :enabled="item.enabled" />
      </div>

      <div class="flex flex-wrap gap-2">
        <BaseButton
          size="sm"
          variant="secondary"
          :loading="isBusy(item.id) && store.isConnecting"
          :disabled="isBusy(item.id)"
          @click="check(item)"
        >
          Check
        </BaseButton>

        <BaseButton size="sm" variant="ghost" :disabled="isBusy(item.id)" @click="toggle(item)">
          {{ item.enabled ? 'Switch off' : 'Switch on' }}
        </BaseButton>

        <BaseButton
          v-if="item.hasCredentials || needsEmail(item)"
          size="sm"
          variant="ghost"
          :disabled="isBusy(item.id)"
          @click="editing === item.id ? cancelEditing() : startEditing(item)"
        >
          {{ editing === item.id ? 'Cancel' : 'Change credential' }}
        </BaseButton>

        <BaseButton
          size="sm"
          variant="ghost"
          :disabled="isBusy(item.id) || item.status === 'disconnected'"
          @click="stop(item)"
        >
          Stop
        </BaseButton>
      </div>

      <form
        v-if="editing === item.id"
        class="flex flex-col gap-3 border-t border-border-subtle pt-3"
        @submit.prevent="saveCredential(item)"
      >
        <BaseInput
          v-if="needsEmail(item)"
          v-model="form.email"
          label="Apple ID"
          type="email"
          autocomplete="email"
          placeholder="name@icloud.com"
          hint="Leave blank to keep the address already saved"
        />
        <BaseInput
          v-model="form.secret"
          :label="needsEmail(item) ? 'App-specific password' : 'Token'"
          type="password"
          autocomplete="off"
          hint="Stored encrypted. It is never shown again — it can be replaced, not read."
        />
        <div>
          <BaseButton
            type="submit"
            size="sm"
            :loading="isBusy(item.id) && store.isSaving"
            :disabled="form.secret.trim().length === 0"
          >
            Save credential
          </BaseButton>
        </div>
      </form>
    </div>

    <RouterLink
      v-if="rows.length > 0"
      :to="{ name: 'integration-hub' }"
      class="text-xs text-ink-500 underline"
    >
      Open the integration hub for tool permissions and activity
    </RouterLink>
  </div>
</template>
