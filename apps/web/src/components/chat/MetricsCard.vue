<script setup lang="ts">
import { formatMoney } from '@hadiya/shared';

import type { MetricsBlock } from '@/chat/message-content';
import ToolResultTable from './ToolResultTable.vue';

/**
 * The shop's own figures, as the assistant read them.
 *
 * Shown alongside the assistant's sentence rather than instead of it: the prose
 * is the answer to what was asked, and these are the numbers it was drawn from,
 * so somebody can check the reasoning rather than take it on trust.
 *
 * Money arrives in minor units and is formatted here with the same helper the
 * dashboard uses, so a total in the chat and the same total on a report page
 * cannot read differently.
 */
defineProps<{ metrics: MetricsBlock }>();
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="rounded-xl bg-surface p-4 ring-1 ring-border-subtle">
      <p v-if="metrics.period" class="mb-3 text-xs font-medium text-ink-500">
        {{ metrics.period }}
      </p>

      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div v-for="figure in metrics.figures" :key="figure.label" class="min-w-0">
          <dt class="text-xs text-ink-500">{{ figure.label }}</dt>
          <dd class="mt-0.5 truncate text-sm font-semibold tabular-nums text-ink-900">
            {{ figure.money ? formatMoney(figure.value) : figure.value }}
          </dd>
        </div>
      </dl>
    </div>

    <ToolResultTable
      v-if="metrics.rows.length > 0"
      :table="{ columns: metrics.columns, rows: metrics.rows, total: null }"
    />
  </div>
</template>
