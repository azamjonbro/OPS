<script setup lang="ts">
import type { Integration } from '@hadiya/shared';
import { computed } from 'vue';

import IntegrationStatusBadge from './IntegrationStatusBadge.vue';
import { PROVIDER_ICONS, PROVIDER_TINTS } from './provider-marks';

/**
 * One connection, as a card you can press.
 *
 * The tile leads with the mark and the name because that is what a person
 * scans for, and it carries exactly one line of detail underneath — the server
 * host for an MCP integration, the provider's own description otherwise. Not
 * the URL's path, which can carry a secret somebody pasted into the wrong
 * field, and never anything derived from a credential.
 */
const props = defineProps<{ integration: Integration }>();

const icon = computed(() => PROVIDER_ICONS[props.integration.provider]);
const tint = computed(() => PROVIDER_TINTS[props.integration.provider]);

/** The host only: a path or a query is not something to render on a card. */
const detail = computed(() => {
  const config = props.integration.config;

  if ('serverUrl' in config && config.serverUrl) {
    try {
      return new URL(config.serverUrl).host;
    } catch {
      return null;
    }
  }

  return props.integration.description;
});

const toolCount = computed(() => {
  const count = props.integration.metadata.toolCount;

  return typeof count === 'number' ? count : null;
});
</script>

<template>
  <RouterLink
    :to="{ name: 'integration', params: { id: integration.id } }"
    class="group flex items-start gap-3 rounded-xl bg-surface p-4 text-left ring-1 ring-border-subtle transition-shadow hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
  >
    <span
      class="grid size-10 shrink-0 place-items-center rounded-lg"
      :class="tint"
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
        <path :d="icon" />
      </svg>
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="truncate text-sm font-semibold text-ink-900">{{ integration.name }}</h3>
        <IntegrationStatusBadge :status="integration.status" :enabled="integration.enabled" />
      </div>

      <p v-if="detail" class="mt-0.5 truncate text-xs text-ink-500">{{ detail }}</p>

      <p v-if="toolCount !== null" class="mt-1.5 text-xs text-ink-500">
        {{ toolCount }} tool{{ toolCount === 1 ? '' : 's' }} discovered
      </p>

      <p
        v-else-if="integration.status === 'error' && integration.lastError"
        class="mt-1.5 line-clamp-2 text-xs text-danger-700"
      >
        {{ integration.lastError }}
      </p>
    </div>

    <svg
      class="mt-1 size-4 shrink-0 text-ink-400 transition-transform group-hover:translate-x-0.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  </RouterLink>
</template>
