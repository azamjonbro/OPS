<script setup lang="ts">
import { formatMoney } from '@hadiya/shared';

import type { MetricsBlock } from '@/chat/message-content';
import ToolResultTable from './ToolResultTable.vue';

defineProps<{ metrics: MetricsBlock }>();
</script>

<template>
  <div class="flex flex-col gap-3 my-2">
    <div class="rounded-[14px] bg-surface p-5 shadow-sm ring-1 ring-border-subtle">
      <p
        v-if="metrics.period"
        class="mb-4 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400"
      >
        {{ metrics.period }}
      </p>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <div v-for="figure in metrics.figures" :key="figure.label" class="min-w-0">
          <dt class="text-[13px] font-medium text-ink-500">{{ figure.label }}</dt>
          <dd class="mt-1 truncate text-[18px] font-bold tabular-nums tracking-tight text-ink-900">
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
