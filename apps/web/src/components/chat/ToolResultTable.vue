<script setup lang="ts">
import { formatMoney } from '@hadiya/shared';
import { computed } from 'vue';

import type { TableBlock } from '@/chat/message-content';

const props = defineProps<{ table: TableBlock }>();

const MAX_ROWS = 8;

const rows = computed(() => props.table.rows.slice(0, MAX_ROWS));

const hidden = computed(() =>
  Math.max((props.table.total ?? props.table.rows.length) - rows.value.length, 0),
);

const cell = (value: string | number | null, money: boolean): string => {
  if (value === null || value === '') {
    return '—';
  }

  return money && typeof value === 'number' ? formatMoney(value) : String(value);
};
</script>

<template>
  <div class="overflow-hidden rounded-[14px] bg-surface shadow-sm ring-1 ring-border-subtle my-2">
    <div class="overflow-x-auto">
      <table class="w-full text-left text-[13px]">
        <thead>
          <tr class="border-b border-border-subtle bg-surface-muted/50">
            <th
              v-for="column in table.columns"
              :key="column.key"
              scope="col"
              class="whitespace-nowrap px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-500"
              :class="column.money ? 'text-right' : ''"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          <tr
            v-for="(row, index) in rows"
            :key="index"
            class="transition-colors hover:bg-surface-muted/30"
          >
            <td
              v-for="column in table.columns"
              :key="column.key"
              class="px-4 py-2.5 text-ink-900"
              :class="column.money ? 'whitespace-nowrap text-right tabular-nums font-medium' : ''"
            >
              {{ cell(row[column.key] ?? null, column.money) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-if="hidden > 0"
      class="border-t border-border-subtle px-4 py-2 text-[12px] font-medium text-ink-500 bg-surface-muted/30"
    >
      {{ hidden }} more not shown.
    </p>
  </div>
</template>
