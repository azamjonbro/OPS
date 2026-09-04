<script setup lang="ts">
import {
  INVENTORY_MOVEMENT_TYPES,
  type InventoryItem,
  type InventoryMovement,
  type Product,
} from '@hadiya/shared';
import { onMounted, reactive, ref } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import BaseTabs from '@/components/ui/BaseTabs.vue';
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { usePermissions } from '@/composables/usePermissions';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { inventoryService, type ManualMovementType } from '@/services/inventory.service';
import { productService } from '@/services/catalogue.service';
import { useBranchesStore } from '@/stores/branches';
import { formatDateTime } from '@/utils/format';

/**
 * Stock on hand, and how it got that way.
 *
 * Nothing here sets a quantity. A correction is *recorded* as a movement and the
 * API computes the new balance in the same transaction that writes the stock
 * card, so on-hand and history can never disagree — which they would if a client
 * could write a number directly.
 */
const { canManageCatalogue } = usePermissions();
const toast = useToast();
const branches = useBranchesStore();

const tab = ref('stock');
const lowOnly = ref('');
const movementType = ref('');

/** Names for the ids the stock rows carry, fetched once for the page. */
const products = ref(new Map<string, Product>());

const stock = usePaginatedResource<InventoryItem>(
  (params, signal) =>
    inventoryService.stock(
      {
        ...params,
        ...(lowOnly.value ? { maxQuantity: Number(lowOnly.value) } : {}),
        ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      },
      { signal },
    ),
  { watchSources: [() => lowOnly.value, () => branches.scopeBranchId] },
);

const movements = usePaginatedResource<InventoryMovement>(
  (params, signal) =>
    inventoryService.movements(
      {
        ...params,
        ...(movementType.value
          ? { type: movementType.value as InventoryMovement['type'] }
          : {}),
        ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      },
      { signal },
    ),
  { watchSources: [() => movementType.value, () => branches.scopeBranchId] },
);

const stockColumns: TableColumn[] = [
  { key: 'product', label: 'Product' },
  { key: 'quantity', label: 'On hand', align: 'right' },
  { key: 'state', label: '', align: 'right' },
];

const movementColumns: TableColumn[] = [
  { key: 'occurredAt', label: 'When' },
  { key: 'product', label: 'Product', hideOnMobile: true },
  { key: 'type', label: 'Type' },
  { key: 'quantity', label: 'Change', align: 'right' },
  { key: 'balanceAfter', label: 'Balance', align: 'right', hideOnMobile: true },
];

const productName = (id: string): string => products.value.get(id)?.name ?? 'Unknown product';
const productSku = (id: string): string => products.value.get(id)?.sku ?? '';

const isMovementOpen = ref(false);
const isSubmitting = ref(false);
const movementError = ref<string | null>(null);
const form = reactive({
  productId: '',
  type: 'purchase' as ManualMovementType,
  quantity: '',
  note: '',
});

const submitMovement = async (): Promise<void> => {
  if (isSubmitting.value) {
    return;
  }

  const quantity = Number(form.quantity);

  if (!form.productId || !Number.isFinite(quantity) || quantity === 0) {
    movementError.value = 'Choose a product and a non-zero quantity.';

    return;
  }

  isSubmitting.value = true;
  movementError.value = null;

  try {
    await inventoryService.recordMovement({
      productId: form.productId,
      type: form.type,
      quantity,
      ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      ...(form.note.trim() ? { note: form.note.trim() } : {}),
    });

    toast.success('Stock movement recorded.');
    isMovementOpen.value = false;
    form.quantity = '';
    form.note = '';
    await Promise.all([stock.reload(), movements.reload()]);
  } catch (caught) {
    movementError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(async () => {
  try {
    const result = await productService.list({ pageSize: 100 });
    products.value = new Map(result.items.map((product) => [product.id, product]));
  } catch {
    products.value = new Map();
  }
});
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Inventory</h2>
        <p class="mt-1 text-sm text-ink-500">
          Stock is changed by recording a movement; the server computes the balance.
        </p>
      </div>
      <BaseButton v-if="canManageCatalogue" @click="isMovementOpen = true">
        Record movement
      </BaseButton>
    </div>

    <BaseTabs
      v-model="tab"
      label="Inventory views"
      :tabs="[
        { value: 'stock', label: 'On hand' },
        { value: 'movements', label: 'Movement history' },
      ]"
    />

    <template v-if="tab === 'stock'">
      <BaseSelect
        v-model="lowOnly"
        label="Show"
        :options="[
          { value: '5', label: 'Low stock (5 or fewer)' },
          { value: '0', label: 'Out of stock only' },
        ]"
        placeholder="All stock"
      />

      <DataTable
        :columns="stockColumns"
        :rows="stock.items.value"
        :loading="stock.isLoading.value"
        :error="stock.error.value"
        :pagination="stock.pagination.value"
        caption="Stock on hand"
        empty-title="No stock records"
        empty-description="Stock appears once a purchase or adjustment has been recorded."
        @retry="stock.reload()"
        @page="stock.goToPage"
      >
        <template #cell-product="{ row }">
          <p class="font-medium text-ink-900">{{ productName(row.product) }}</p>
          <p class="font-mono text-xs text-ink-500">{{ productSku(row.product) }}</p>
        </template>

        <template #cell-quantity="{ row }">
          <span class="font-medium text-ink-900">{{ row.quantity }}</span>
        </template>

        <template #cell-state="{ row }">
          <BaseBadge v-if="row.quantity <= 0" tone="danger" dot>Out of stock</BaseBadge>
          <BaseBadge v-else-if="row.quantity <= 5" tone="warning" dot>Low</BaseBadge>
          <BaseBadge v-else tone="positive" dot>In stock</BaseBadge>
        </template>
      </DataTable>
    </template>

    <template v-else>
      <BaseSelect
        v-model="movementType"
        label="Type"
        :options="INVENTORY_MOVEMENT_TYPES.map((value) => ({ value, label: value }))"
        placeholder="All movement types"
      />

      <DataTable
        :columns="movementColumns"
        :rows="movements.items.value"
        :loading="movements.isLoading.value"
        :error="movements.error.value"
        :pagination="movements.pagination.value"
        caption="Stock movements"
        empty-title="No movements recorded"
        empty-description="Purchases, sales and adjustments all appear here."
        @retry="movements.reload()"
        @page="movements.goToPage"
      >
        <template #cell-occurredAt="{ row }">
          <span class="text-xs text-ink-700">{{ formatDateTime(row.occurredAt) }}</span>
          <span class="block text-xs text-ink-500 sm:hidden">{{ productName(row.product) }}</span>
        </template>

        <template #cell-product="{ row }">
          <span class="text-sm text-ink-700">{{ productName(row.product) }}</span>
        </template>

        <template #cell-type="{ row }">
          <BaseBadge :tone="row.quantity < 0 ? 'warning' : 'neutral'">{{ row.type }}</BaseBadge>
        </template>

        <template #cell-quantity="{ row }">
          <span
            class="font-medium tabular-nums"
            :class="row.quantity < 0 ? 'text-danger-600' : 'text-positive-700'"
          >
            {{ row.quantity > 0 ? '+' : '' }}{{ row.quantity }}
          </span>
        </template>

        <template #cell-balanceAfter="{ row }">
          <span class="tabular-nums text-ink-700">{{ row.balanceAfter }}</span>
        </template>
      </DataTable>
    </template>

    <BaseModal v-model:open="isMovementOpen" title="Record stock movement" size="sm">
      <div class="flex flex-col gap-4">
        <BaseSelect
          v-model="form.productId"
          label="Product"
          required
          :options="[...products.values()].map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))"
          placeholder="Choose a product"
        />
        <BaseSelect
          v-model="form.type"
          label="Type"
          :options="[
            { value: 'purchase', label: 'Purchase — stock received' },
            { value: 'return', label: 'Return — stock came back' },
            { value: 'adjustment', label: 'Adjustment — correction' },
          ]"
        />
        <BaseInput
          v-model="form.quantity"
          label="Quantity"
          type="number"
          inputmode="decimal"
          step="0.001"
          required
          :hint="
            form.type === 'adjustment'
              ? 'Signed: negative reduces stock'
              : 'How many units to add'
          "
        />
        <BaseInput v-model="form.note" label="Note" placeholder="Optional" :maxlength="500" />
        <p v-if="movementError" class="text-sm text-danger-600" role="alert">{{ movementError }}</p>
      </div>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isSubmitting" @click="isMovementOpen = false">
          Cancel
        </BaseButton>
        <BaseButton :loading="isSubmitting" @click="submitMovement">Record</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
