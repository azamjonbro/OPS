<script setup lang="ts">
import { formatMoney, type Product } from '@hadiya/shared';
import { onBeforeUnmount, ref, watch } from 'vue';

import BaseInput from '@/components/ui/BaseInput.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { isCancelled, toErrorMessage } from '@/services/api-error';
import { productService } from '@/services/catalogue.service';

/**
 * Finding something to sell.
 *
 * Two paths, because a counter has two. Typing searches by name, SKU or
 * barcode, debounced. Scanning is the same box: a barcode scanner types fast
 * and ends with Enter, so pressing Enter looks the value up as an exact barcode
 * first and adds the single match straight to the basket — which is what makes
 * scanning feel instant rather than "search, then click".
 */
const emit = defineEmits<{ select: [product: Product] }>();

const query = useDebouncedRef('', 250);
const rawQuery = ref('');
const products = ref<Product[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);
const scanNotice = ref<string | null>(null);

let controller: AbortController | null = null;

const search = async (): Promise<void> => {
  controller?.abort();
  controller = new AbortController();

  const term = query.value.trim();

  if (term.length === 0) {
    products.value = [];
    error.value = null;
    isLoading.value = false;

    return;
  }

  isLoading.value = true;
  error.value = null;

  try {
    const result = await productService.list(
      { search: term, isActive: true, pageSize: 24 },
      { signal: controller.signal },
    );

    products.value = result.items;
  } catch (caught) {
    if (isCancelled(caught)) {
      return;
    }

    error.value = toErrorMessage(caught);
    products.value = [];
  } finally {
    isLoading.value = false;
  }
};

watch(query, () => void search());

/**
 * Enter means "I scanned this".
 *
 * The exact-barcode lookup is tried first because a scan is unambiguous; a
 * single search result is accepted too, since a cashier who typed a full SKU
 * and pressed Enter means the same thing.
 */
const onEnter = async (): Promise<void> => {
  const term = rawQuery.value.trim();

  if (term.length === 0) {
    return;
  }

  scanNotice.value = null;

  try {
    const exact = await productService.list({ barcode: term, isActive: true, pageSize: 1 });
    const scanned = exact.items[0];

    if (scanned) {
      emit('select', scanned);
      rawQuery.value = '';
      query.value = '';
      products.value = [];

      return;
    }

    if (products.value.length === 1 && products.value[0]) {
      emit('select', products.value[0]);
      rawQuery.value = '';
      query.value = '';
      products.value = [];

      return;
    }

    scanNotice.value = `Nothing scanned as "${term}".`;
  } catch (caught) {
    error.value = toErrorMessage(caught);
  }
};

watch(rawQuery, (value) => {
  query.value = value;
});

onBeforeUnmount(() => controller?.abort());
</script>

<template>
  <div class="flex min-h-0 flex-col gap-3">
    <BaseInput
      v-model="rawQuery"
      label="Scan or search"
      type="search"
      placeholder="Barcode, SKU or product name"
      autocomplete="off"
      :hint="scanNotice ?? 'Press Enter after a scan'"
      @keyup.enter="onEnter"
    />

    <div class="min-h-0 flex-1 overflow-y-auto">
      <LoadingSkeleton v-if="isLoading" variant="row" :rows="4" />

      <ErrorState v-else-if="error" :message="error" @retry="search" />

      <EmptyState
        v-else-if="rawQuery.trim().length === 0"
        title="Scan or search to begin"
        description="Products you find appear here; choose one to add it to the sale."
        icon="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
      />

      <EmptyState
        v-else-if="products.length === 0"
        title="No product matches"
        :description="`Nothing active matches “${rawQuery.trim()}”.`"
        icon="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16Z"
      />

      <ul v-else class="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <li v-for="product in products" :key="product.id">
          <button
            type="button"
            class="flex h-full w-full flex-col items-start gap-1 rounded-xl bg-surface p-3 text-left ring-1 ring-border-subtle transition-colors hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-600"
            @click="emit('select', product)"
          >
            <span class="line-clamp-2 text-sm font-medium text-ink-900">{{ product.name }}</span>
            <span class="font-mono text-xs text-ink-500">{{ product.sku }}</span>
            <span class="mt-auto text-sm font-semibold tabular-nums text-brand-700">
              {{ formatMoney(product.price) }}
            </span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>
