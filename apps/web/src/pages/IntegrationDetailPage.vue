<script setup lang="ts">
import type { McpToolPermission } from '@hadiya/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import IntegrationStatusBadge from '@/components/integrations/IntegrationStatusBadge.vue';
import McpToolRow from '@/components/integrations/McpToolRow.vue';
import { PROVIDER_ICONS, PROVIDER_TINTS } from '@/components/integrations/provider-marks';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { useIntegrationsStore } from '@/stores/integrations';

/**
 * One integration: whether it works, what it offers, and what the assistant may
 * do with each of those things.
 *
 * The tool table is the reason this page exists. Everything above it — the
 * status, the buttons, the last error — could live on a tile; the permissions
 * could not, and they are the difference between "Hadiya is connected to my
 * CRM" and "Hadiya may delete my customers".
 *
 * Nothing on this page can show a credential, because the API does not return
 * one. `hasCredentials` is all there is, and it is rendered as a sentence
 * rather than as a masked field, since a row of dots implies a value that could
 * be revealed.
 */
const route = useRoute();
const router = useRouter();
const store = useIntegrationsStore();

const isConfirmingDelete = ref(false);
const toolFilter = ref('');

const id = computed(() => String(route.params.id));
const integration = computed(() => store.current);

const isMcp = computed(() => integration.value?.type === 'mcp');

const serverUrl = computed(() => {
  const config = integration.value?.config;

  return config && 'serverUrl' in config ? config.serverUrl : null;
});

const authMethod = computed(() => {
  const config = integration.value?.config;

  return config && 'authMethod' in config ? config.authMethod : null;
});

/** Filtering matters here: a server may advertise a hundred tools. */
const visibleTools = computed(() => {
  const tools = integration.value?.tools ?? [];
  const needle = toolFilter.value.trim().toLowerCase();

  if (!needle) {
    return tools;
  }

  return tools.filter(
    (tool) =>
      tool.name.toLowerCase().includes(needle) || tool.description.toLowerCase().includes(needle),
  );
});

const riskyCount = computed(
  () =>
    integration.value?.tools.filter((tool) => tool.permission === 'requires_confirmation').length ??
    0,
);

const formatted = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : 'Never');

const setPermission = (tool: string, permission: McpToolPermission): void => {
  void store.setToolPermission(id.value, tool, permission);
};

const remove = async (): Promise<void> => {
  if (await store.remove(id.value)) {
    isConfirmingDelete.value = false;
    await router.push({ name: 'integration-hub' });
  }
};

const toggleEnabled = (): void => {
  const current = integration.value;

  if (current) {
    void store.update(id.value, { enabled: !current.enabled });
  }
};

onMounted(() => void store.open(id.value));

// The route can change under the component when a person follows a link from
// one integration to another.
watch(id, (next) => void store.open(next));
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <RouterLink
      :to="{ name: 'integration-hub' }"
      class="inline-flex w-fit items-center gap-1.5 text-sm text-ink-500 hover:text-ink-900"
    >
      <svg
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="m15 18-6-6 6-6" />
      </svg>
      Integrations
    </RouterLink>

    <LoadingSkeleton v-if="store.isLoading && !integration" variant="card" :rows="3" />

    <ErrorState
      v-else-if="store.error && !integration"
      :message="store.error"
      @retry="store.open(id)"
    />

    <template v-else-if="integration">
      <div class="flex items-start gap-3">
        <span
          class="grid size-11 shrink-0 place-items-center rounded-xl"
          :class="PROVIDER_TINTS[integration.provider]"
          aria-hidden="true"
        >
          <svg
            class="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.7"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="PROVIDER_ICONS[integration.provider]" />
          </svg>
        </span>

        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-xl font-semibold text-ink-900">{{ integration.name }}</h2>
            <IntegrationStatusBadge :status="integration.status" :enabled="integration.enabled" />
          </div>
          <p v-if="integration.description" class="mt-0.5 text-sm text-ink-500">
            {{ integration.description }}
          </p>
        </div>
      </div>

      <!-- What happened last, in the words the API chose. Never a stack trace. -->
      <div
        v-if="store.lastHealth"
        class="rounded-xl px-4 py-3 text-sm ring-1 ring-inset"
        :class="
          store.lastHealth.healthy
            ? 'bg-positive-50 text-positive-700 ring-positive-600/30'
            : 'bg-danger-50 text-danger-700 ring-danger-600/30'
        "
      >
        {{ store.lastHealth.message }}
      </div>

      <p
        v-else-if="integration.status === 'error' && integration.lastError"
        class="rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-inset ring-danger-600/30"
      >
        {{ integration.lastError }}
      </p>

      <BaseCard title="Connection" description="Nothing here is a credential">
        <dl class="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Provider</dt>
            <dd class="mt-0.5 text-ink-900">{{ integration.provider }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Added</dt>
            <dd class="mt-0.5 text-ink-900">{{ formatted(integration.createdAt) }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Last connected</dt>
            <dd class="mt-0.5 text-ink-900">{{ formatted(integration.lastConnectedAt) }}</dd>
          </div>
          <div v-if="integration.lastErrorAt">
            <dt class="text-xs uppercase tracking-wide text-ink-500">Last failure</dt>
            <dd class="mt-0.5 text-ink-900">{{ formatted(integration.lastErrorAt) }}</dd>
          </div>
          <div v-if="serverUrl" class="sm:col-span-2">
            <dt class="text-xs uppercase tracking-wide text-ink-500">Server</dt>
            <dd class="mt-0.5 break-all font-mono text-xs text-ink-700">{{ serverUrl }}</dd>
          </div>
          <div v-if="authMethod">
            <dt class="text-xs uppercase tracking-wide text-ink-500">Authentication</dt>
            <dd class="mt-0.5 text-ink-900">{{ authMethod }}</dd>
          </div>
          <div>
            <dt class="text-xs uppercase tracking-wide text-ink-500">Credential</dt>
            <!--
              A sentence, not a masked field: a row of dots implies a value that
              could be revealed, and this one never can be.
            -->
            <dd class="mt-0.5 text-ink-900">
              {{ integration.hasCredentials ? 'Saved and encrypted' : 'None saved' }}
            </dd>
          </div>
        </dl>

        <div class="mt-4 flex flex-wrap gap-2 border-t border-border-subtle pt-3">
          <BaseButton
            size="sm"
            :loading="store.isConnecting"
            :disabled="!integration.enabled"
            @click="store.connect(id)"
          >
            {{ integration.status === 'connected' ? 'Reconnect' : 'Connect' }}
          </BaseButton>

          <BaseButton
            size="sm"
            variant="secondary"
            :loading="store.isConnecting"
            @click="store.test(id)"
          >
            Test connection
          </BaseButton>

          <BaseButton
            v-if="isMcp && integration.status === 'connected'"
            size="sm"
            variant="secondary"
            :loading="store.isConnecting"
            @click="store.refresh(id)"
          >
            Refresh tools
          </BaseButton>

          <BaseButton size="sm" variant="ghost" :disabled="store.isSaving" @click="toggleEnabled">
            {{ integration.enabled ? 'Switch off' : 'Switch on' }}
          </BaseButton>

          <BaseButton
            v-if="integration.hasCredentials && integration.status !== 'disconnected'"
            size="sm"
            variant="ghost"
            :loading="store.isConnecting"
            @click="store.disconnect(id)"
          >
            Disconnect
          </BaseButton>

          <BaseButton size="sm" variant="danger" class="ms-auto" @click="isConfirmingDelete = true">
            Delete
          </BaseButton>
        </div>
      </BaseCard>

      <BaseCard
        v-if="isMcp"
        title="Tools"
        :description="
          riskyCount > 0
            ? `${riskyCount} of these will ask before running`
            : 'What this server offers, and what Hadiya may do with it'
        "
      >
        <div v-if="integration.tools.length > 0" class="flex flex-col gap-3">
          <input
            v-if="integration.tools.length > 8"
            v-model="toolFilter"
            type="search"
            placeholder="Filter tools"
            class="h-9 w-full rounded-lg bg-surface px-3 text-sm text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600"
          />

          <div class="divide-y divide-border-subtle">
            <McpToolRow
              v-for="tool in visibleTools"
              :key="tool.name"
              :tool="tool"
              :busy="store.isSaving"
              @change="(permission) => setPermission(tool.name, permission)"
            />
          </div>

          <p v-if="visibleTools.length === 0" class="py-4 text-sm text-ink-500">
            No tool matches “{{ toolFilter }}”.
          </p>

          <p class="text-xs text-ink-500">
            Tools that read are enabled by default. Anything that writes, deletes, or that Hadiya
            could not classify asks you first — and a blocked tool is never even mentioned to the
            assistant.
          </p>
        </div>

        <EmptyState
          v-else
          title="No tools discovered yet"
          description="Connect the integration and Hadiya will ask the server what it offers."
          :icon="PROVIDER_ICONS.custom_mcp"
        />
      </BaseCard>

      <BaseCard
        v-else
        title="What this can do"
        description="Built into Hadiya rather than discovered"
      >
        <p class="text-sm text-ink-700">
          {{
            integration.provider === 'billz'
              ? 'Hadiya reads the shop live: catalogue, till, stock, customers and debts. It never writes to Billz.'
              : 'Hadiya can search the pages you shared with it and quote them back. It never edits your workspace.'
          }}
        </p>
      </BaseCard>
    </template>

    <ConfirmDialog
      v-model:open="isConfirmingDelete"
      title="Delete this integration?"
      message="Its saved credential is destroyed, its tools stop being available to the assistant, and the connection has to be set up again from scratch. The record of what it did is kept."
      confirm-label="Delete"
      :busy="store.isSaving"
      @confirm="remove"
    />
  </div>
</template>
