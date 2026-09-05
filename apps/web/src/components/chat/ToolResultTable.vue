<script setup lang="ts">
import { formatMoney } from '@hadiya/shared';
import { computed } from 'vue';

import type { TableBlock } from '@/chat/message-content';

const props = defineProps<{ table: TableBlock }>();

/**
 * Rows a tool answered with — products, reminders, plans, whatever comes next.
 *
 * The columns are derived from the rows rather than declared per tool, so a
 * capability the frontend has not been taught about still renders as a table.
 * That is the point: the backend owns which tools exist, and the chat should
 * not need a release to show one legibly.
 *
 * Long results are cut, with the true count shown, because a chat column is not
 * a report and forty rows in a bubble is not readable. The proper list lives on
 * its own screen.
 */
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
  <div class="overflow-hidden rounded-xl bg-surface ring-1 ring-border-subtle">
    <!-- A wide result scrolls inside the bubble rather than widening the page. -->
    <div class="overflow-x-auto">
      <table class="w-full text-left text-xs">
        <thead>
          <tr class="border-b border-border-subtle bg-surface-muted">
            <th
              v-for="column in table.columns"
              :key="column.key"
              scope="col"
              class="whitespace-nowrap px-3 py-2 font-semibold text-ink-700"
              :class="column.money ? 'text-right' : ''"
            >
              {{ column.label }}
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-border-subtle">
          <tr v-for="(row, index) in rows" :key="index">
            <td
              v-for="column in table.columns"
              :key="column.key"
              class="px-3 py-2 text-ink-900"
              :class="column.money ? 'whitespace-nowrap text-right tabular-nums' : ''"
            >
              {{ cell(row[column.key] ?? null, column.money) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="hidden > 0" class="border-t border-border-subtle px-3 py-2 text-xs text-ink-500">
      {{ hidden }} more not shown.
    </p>
  </div>
</template>
