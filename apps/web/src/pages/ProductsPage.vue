<script setup lang="ts">
import { formatMoney, type Category, type Product } from '@hadiya/shared';
import { computed, onMounted, ref } from 'vue';

import ProductFormModal from '@/components/products/ProductFormModal.vue';
import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { usePermissions } from '@/composables/usePermissions';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { categoryService, productService } from '@/services/catalogue.service';

/**
 * The product catalogue.
 *
 * List state is local: nothing else in the application reads this page's rows,
 * and putting them in a store would make two screens fight over one array. The
 * search is debounced and its request cancelled when superseded, so a fast
 * typist does not race a stale reply onto the screen.
 */
const { canManageCatalogue } = usePermissions();
const toast = useToast();

const search = useDebouncedRef('', 300);
const categoryId = ref('');
const activeFilter = ref('');

const categories = ref<Category[]>([]);

const products = usePaginatedResource<Product>(
  (params, signal) =>
    productService.list(
      {
        ...params,
        ...(search.value ? { search: search.value } : {}),
        ...(categoryId.value ? { categoryId: categoryId.value } : {}),
        ...(activeFilter.value ? { isActive: activeFilter.value === 'active' } : {}),
      },
      { signal },
    ),
  { watchSources: [() => search.value, () => categoryId.value, () => activeFilter.value] },
);

const isFormOpen = ref(false);
const editing = ref<Product | null>(null);
const deactivating = ref<Product | null>(null);
const isDeactivating = ref(false);

const columns: TableColumn[] = [
  { key: 'name', label: 'Product' },
  { key: 'sku', label: 'SKU', hideOnMobile: true },
  { key: 'price', label: 'Price', align: 'right' },
  { key: 'status', label: 'Status', align: 'right' },
  { key: 'actions', label: '', align: 'right', width: '1%' },
];

const categoryOptions = computed(() => [
  ...categories.value.map((category) => ({ value: category.id, label: category.name })),
]);

const categoryName = (id: string): string =>
  categories.value.find((category) => category.id === id)?.name ?? '—';

const openCreate = (): void => {
  editing.value = null;
  isFormOpen.value = true;
};

const openEdit = (product: Product): void => {
  editing.value = product;
  isFormOpen.value = true;
};

const confirmDeactivate = async (): Promise<void> => {
  const product = deactivating.value;

  if (!product || isDeactivating.value) {
    return;
  }

  isDeactivating.value = true;

  try {
    await productService.deactivate(product.id);
    toast.success(`${product.name} deactivated.`);
    deactivating.value = null;
    await products.reload();
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isDeactivating.value = false;
  }
};

const reactivate = async (product: Product): Promise<void> => {
  try {
    await productService.update(product.id, { isActive: true });
    toast.success(`${product.name} reactivated.`);
    await products.reload();
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  }
};

onMounted(async () => {
  try {
    const result = await categoryService.list({ pageSize: 100, isActive: true });
    categories.value = result.items;
  } catch {
    // The filter simply offers no categories; the list still works.
    categories.value = [];
  }
});
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Products</h2>
        <p class="mt-1 text-sm text-ink-500">Everything the shop sells.</p>
      </div>
      <BaseButton v-if="canManageCatalogue" @click="openCreate">New product</BaseButton>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <BaseInput
        v-model="search"
        label="Search"
        type="search"
        placeholder="Name, SKU or barcode"
        autocomplete="off"
      />
      <BaseSelect
        v-model="categoryId"
        label="Category"
        :options="categoryOptions"
        placeholder="All categories"
      />
      <BaseSelect
        v-model="activeFilter"
        label="Status"
        :options="[
          { value: 'active', label: 'Active' },
          { value: 'inactive', label: 'Inactive' },
        ]"
        placeholder="All statuses"
      />
    </div>

    <DataTable
      :columns="columns"
      :rows="products.items.value"
      :loading="products.isLoading.value"
      :error="products.error.value"
      :pagination="products.pagination.value"
      caption="Products"
      empty-title="No products match"
      empty-description="Adjust the filters, or add the first product."
      @retry="products.reload()"
      @page="products.goToPage"
    >
      <template #cell-name="{ row }">
        <p class="font-medium text-ink-900">{{ row.name }}</p>
        <p class="text-xs text-ink-500">
          {{ categoryName(row.category) }}
          <span class="sm:hidden">· {{ row.sku }}</span>
        </p>
      </template>

      <template #cell-sku="{ row }">
        <span class="font-mono text-xs text-ink-700">{{ row.sku }}</span>
        <span v-if="row.barcode" class="block font-mono text-xs text-ink-400">{{ row.barcode }}</span>
      </template>

      <template #cell-price="{ row }">
        <span class="font-medium text-ink-900">{{ formatMoney(row.price) }}</span>
        <span class="block text-xs text-ink-500">per {{ row.unit }}</span>
      </template>

      <template #cell-status="{ row }">
        <BaseBadge :tone="row.isActive ? 'positive' : 'neutral'" dot>
          {{ row.isActive ? 'Active' : 'Inactive' }}
        </BaseBadge>
      </template>

      <template #cell-actions="{ row }">
        <div v-if="canManageCatalogue" class="flex justify-end gap-1">
          <BaseButton variant="ghost" size="sm" @click="openEdit(row)">Edit</BaseButton>
          <BaseButton
            v-if="row.isActive"
            variant="ghost"
            size="sm"
            @click="deactivating = row"
          >
            Deactivate
          </BaseButton>
          <BaseButton v-else variant="ghost" size="sm" @click="reactivate(row)">Restore</BaseButton>
        </div>
      </template>

      <template #empty-action>
        <BaseButton v-if="canManageCatalogue" size="sm" @click="openCreate">New product</BaseButton>
      </template>
    </DataTable>

    <ProductFormModal
      v-model:open="isFormOpen"
      :product="editing"
      :categories="categories"
      @saved="products.reload()"
    />

    <ConfirmDialog
      :open="deactivating !== null"
      title="Deactivate product"
      :message="`${deactivating?.name ?? ''} will stop appearing at the till. Its history is kept and it can be restored later.`"
      confirm-label="Deactivate"
      :busy="isDeactivating"
      @update:open="(value) => !value && (deactivating = null)"
      @confirm="confirmDeactivate"
      @cancel="deactivating = null"
    />
  </div>
</template>
