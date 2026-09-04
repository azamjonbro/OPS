<script setup lang="ts">
import type { PaginationMeta } from '@hadiya/shared';
import { computed } from 'vue';

import BaseButton from './BaseButton.vue';

/**
 * Page controls driven by the API's own pagination metadata.
 *
 * It renders nothing for a single page — controls that can only be disabled are
 * noise — and it reports the range in words, because "showing 21–40 of 137" is
 * what a person actually wants to know.
 */
const props = defineProps<{ pagination: PaginationMeta; disabled?: boolean }>();

const emit = defineEmits<{ change: [page: number] }>();

const from = computed(() =>
  props.pagination.total === 0 ? 0 : (props.pagination.page - 1) * props.pagination.pageSize + 1,
);

const to = computed(() =>
  Math.min(props.pagination.page * props.pagination.pageSize, props.pagination.total),
);
</script>

<template>
  <nav
    v-if="pagination.totalPages > 1"
    class="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3"
    aria-label="Pagination"
  >
    <p class="text-xs text-ink-500" aria-live="polite">
      Showing {{ from }}–{{ to }} of {{ pagination.total }}
    </p>

    <div class="flex items-center gap-2">
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="disabled || !pagination.hasPrevious"
        @click="emit('change', pagination.page - 1)"
      >
        Previous
      </BaseButton>
      <span class="text-xs text-ink-500">
        Page {{ pagination.page }} of {{ pagination.totalPages }}
      </span>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="disabled || !pagination.hasNext"
        @click="emit('change', pagination.page + 1)"
      >
        Next
      </BaseButton>
    </div>
  </nav>
</template>
