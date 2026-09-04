<script setup lang="ts">
import type { MessageToolCall } from '@hadiya/shared';
import { computed } from 'vue';

import { toolFamily, toolLabel } from '@/chat/tool-labels';

/**
 * One step the assistant took.
 *
 * It says what happened in the person's terms — "Read the sales figures", not
 * `get_sales_summary` — and nothing about how. No arguments, no endpoints, no
 * ids: those are implementation detail, and a business user reading "queried
 * /v1/sales?from=…" learns nothing except that the product leaks.
 *
 * The result summary is shown on request rather than by default, because it is
 * written for the model and is usually a dense line of figures the prose above
 * already explains properly.
 */
const props = defineProps<{ call: MessageToolCall; running?: boolean }>();

const label = computed(() => toolLabel(props.call.name));
const family = computed(() => toolFamily(props.call.name));

const ICONS: Record<string, string> = {
  data: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  content: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  reminder: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  memory: 'M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-6H5v-2a7 7 0 1 1 14 0v2h-2v6h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z',
  other: 'M12 6v6l4 2M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z',
};
</script>

<template>
  <div
    class="flex items-center gap-2.5 rounded-lg bg-surface-muted px-3 py-2 text-xs ring-1 ring-border-subtle"
    :aria-busy="running ? 'true' : undefined"
  >
    <span
      class="grid size-6 shrink-0 place-items-center rounded-md bg-surface text-ink-500 ring-1 ring-border-subtle"
      aria-hidden="true"
    >
      <svg
        v-if="running"
        class="size-3.5 animate-spin text-brand-600"
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
      </svg>
      <svg
        v-else
        class="size-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="ICONS[family] ?? ICONS.other" />
      </svg>
    </span>

    <span class="min-w-0 flex-1 text-ink-700">
      {{ running ? `${label.running}…` : label.done }}
    </span>

    <details v-if="!running && call.result" class="shrink-0">
      <summary class="cursor-pointer list-none text-ink-500 hover:text-ink-900">Details</summary>
      <p class="mt-2 max-w-md whitespace-pre-line text-left text-ink-700">{{ call.result }}</p>
    </details>
  </div>
</template>
