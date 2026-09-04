<script setup lang="ts" generic="TRow extends { id: string }">
import type { PaginationMeta } from '@hadiya/shared';

import BasePagination from './BasePagination.vue';
import EmptyState from './EmptyState.vue';
import ErrorState from './ErrorState.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';

export interface TableColumn {
  key: string;
  label: string;
  /** Right-align numbers so digits line up down the column. */
  align?: 'left' | 'right';
  /** Hidden below the small breakpoint, for columns that are nice-to-have. */
  hideOnMobile?: boolean;
  width?: string;
}

/**
 * The one table in the application.
 *
 * It owns the four states every data page has to handle — loading, error,
 * empty, success — so no page can accidentally ship three of them and a blank
 * screen for the fourth. Cells are provided by the caller through a slot per
 * column, which keeps formatting decisions where the data is understood.
 *
 * On narrow screens the table scrolls inside its own container rather than
 * pushing the page sideways, and columns marked `hideOnMobile` drop out first.
 */
withDefaults(
  defineProps<{
    columns: TableColumn[];
    rows: TRow[];
    loading?: boolean;
    error?: string | null;
    pagination?: PaginationMeta | null;
    emptyTitle?: string;
    emptyDescription?: string;
    /** Row identity for the caller's `@select`; omit to make rows inert. */
    selectable?: boolean;
    caption?: string;
  }>(),
  {
    loading: false,
    error: null,
    pagination: null,
    emptyTitle: 'Nothing here yet',
    emptyDescription: undefined,
    selectable: false,
    caption: undefined,
  },
);

const emit = defineEmits<{ retry: []; page: [page: number]; select: [row: TRow] }>();
</script>

<template>
  <div class="overflow-hidden rounded-xl bg-surface ring-1 ring-border-subtle">
    <div v-if="loading" class="p-4">
      <LoadingSkeleton variant="row" :rows="5" />
    </div>

    <ErrorState v-else-if="error" :message="error" @retry="emit('retry')" />

    <template v-else-if="rows.length === 0">
      <EmptyState :title="emptyTitle" :description="emptyDescription">
        <slot name="empty-action" />
      </EmptyState>
    </template>

    <template v-else>
      <div class="overflow-x-auto">
        <table class="w-full min-w-full border-collapse text-sm">
          <caption v-if="caption" class="sr-only">
            {{ caption }}
          </caption>
          <thead>
            <tr class="border-b border-border-subtle bg-surface-muted/60">
              <th
                v-for="column in columns"
                :key="column.key"
                scope="col"
                class="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-500"
                :class="[
                  column.align === 'right' ? 'text-right' : 'text-left',
                  column.hideOnMobile ? 'hidden sm:table-cell' : '',
                ]"
                :style="column.width ? { width: column.width } : undefined"
              >
                {{ column.label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.id"
              class="border-b border-border-subtle last:border-0"
              :class="
                selectable
                  ? 'cursor-pointer transition-colors hover:bg-surface-muted focus-within:bg-surface-muted'
                  : ''
              "
              @click="selectable && emit('select', row)"
            >
              <td
                v-for="column in columns"
                :key="column.key"
                class="px-4 py-3 text-ink-700"
                :class="[
                  column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                  column.hideOnMobile ? 'hidden sm:table-cell' : '',
                ]"
              >
                <slot :name="`cell-${column.key}`" :row="row">
                  {{ (row as Record<string, unknown>)[column.key] }}
                </slot>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <BasePagination
        v-if="pagination"
        :pagination="pagination"
        :disabled="loading"
        @change="(page) => emit('page', page)"
      />
    </template>
  </div>
</template>
