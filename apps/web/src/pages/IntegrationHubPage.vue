<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import AddIntegrationDialog from '@/components/integrations/AddIntegrationDialog.vue';
import IntegrationTile from '@/components/integrations/IntegrationTile.vue';
import { PROVIDER_ICONS, PROVIDER_TINTS } from '@/components/integrations/provider-marks';
import BaseButton from '@/components/ui/BaseButton.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import type { CreateIntegrationPayload } from '@/services/integration.service';
import { useIntegrationsStore } from '@/stores/integrations';

/**
 * What Hadiya is connected to.
 *
 * The page is a list of connections and one button, and it is deliberately not
 * a dashboard: nothing here is a chart, a metric or a table of rows. A person
 * comes to this screen to add something, to see whether something is working,
 * or to switch something off, and each of those is one press away.
 *
 * Connected integrations come first because that is what the page is for.
 * Everything else — what could be added — is behind the button, so the screen
 * does not advertise five things Hadiya cannot do to somebody who wanted to
 * check on the one it can.
 */
const store = useIntegrationsStore();
const router = useRouter();

const isAdding = ref(false);

const working = computed(() =>
  store.integrations.filter((item) => item.enabled && item.status === 'connected'),
);

const needingAttention = computed(() =>
  store.integrations.filter((item) => item.enabled && item.status === 'error'),
);

const idle = computed(() =>
  store.integrations.filter(
    (item) => !item.enabled || (item.status !== 'connected' && item.status !== 'error'),
  ),
);

/** Providers that are not connected yet, as a hint under the button. */
const available = computed(() =>
  store.catalogue.filter(
    (provider) =>
      provider.available &&
      (provider.type === 'mcp' ||
        !store.integrations.some((item) => item.provider === provider.provider)),
  ),
);

const add = async (payload: CreateIntegrationPayload): Promise<void> => {
  const created = await store.create(payload);

  if (created) {
    isAdding.value = false;
    // Straight to the detail page, which is where the connection is actually
    // made: creating stores the settings, and the next step is proving they
    // work and choosing what the assistant may do.
    await router.push({ name: 'integration', params: { id: created.id } });
  }
};

onMounted(store.load);
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Integrations</h2>
        <p class="mt-1 text-sm text-ink-500">
          What Hadiya can reach on your behalf, and what it is allowed to do there.
        </p>
      </div>

      <BaseButton @click="isAdding = true">
        <svg
          class="size-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add integration
      </BaseButton>
    </div>

    <LoadingSkeleton v-if="store.isLoading && !store.hasAny" variant="card" :rows="3" />

    <ErrorState
      v-else-if="store.error && !store.hasAny"
      :message="store.error"
      @retry="store.load"
    />

    <template v-else>
      <section v-if="needingAttention.length > 0" class="flex flex-col gap-2">
        <h3 class="text-xs font-medium uppercase tracking-wide text-ink-500">Needs attention</h3>
        <IntegrationTile
          v-for="integration in needingAttention"
          :key="integration.id"
          :integration="integration"
        />
      </section>

      <section v-if="working.length > 0" class="flex flex-col gap-2">
        <h3 class="text-xs font-medium uppercase tracking-wide text-ink-500">Connected</h3>
        <IntegrationTile
          v-for="integration in working"
          :key="integration.id"
          :integration="integration"
        />
      </section>

      <section v-if="idle.length > 0" class="flex flex-col gap-2">
        <h3 class="text-xs font-medium uppercase tracking-wide text-ink-500">Not connected</h3>
        <IntegrationTile
          v-for="integration in idle"
          :key="integration.id"
          :integration="integration"
        />
      </section>

      <EmptyState
        v-if="!store.hasAny"
        title="Nothing connected yet"
        description="Connect Billz to let Hadiya read the shop, Notion to let it read your notes, or your own MCP server to give it tools of your choosing."
        :icon="PROVIDER_ICONS.custom_mcp"
      >
        <BaseButton class="mt-1" @click="isAdding = true">Add your first integration</BaseButton>
      </EmptyState>

      <!--
        What could be added, as a quiet row rather than a second grid of cards.
        A connected integration and an offer to connect one are different things
        and should not look alike.
      -->
      <div v-if="store.hasAny && available.length > 0" class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-ink-500">You can also connect</span>
        <button
          v-for="provider in available"
          :key="provider.provider"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ring-border-subtle transition-colors hover:bg-surface-muted"
          :class="PROVIDER_TINTS[provider.provider]"
          @click="isAdding = true"
        >
          <svg
            class="size-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path :d="PROVIDER_ICONS[provider.provider]" />
          </svg>
          {{ provider.label }}
        </button>
      </div>
    </template>

    <p class="text-xs text-ink-500">
      Tokens are stored encrypted and are never shown again — not on this screen, not in the API,
      not to the assistant.
    </p>

    <AddIntegrationDialog
      v-model:open="isAdding"
      :catalogue="store.catalogue"
      :busy="store.isSaving"
      @submit="add"
    />
  </div>
</template>
