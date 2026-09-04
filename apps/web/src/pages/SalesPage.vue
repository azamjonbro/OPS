<script setup lang="ts">
import { formatMoney, SALE_STATUSES, type Sale } from '@hadiya/shared';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { saleService } from '@/services/sales.service';
import { useBranchesStore } from '@/stores/branches';
import { formatDateTime } from '@/utils/format';

/** The sales journal: what was rung up, by whom, and whether it was paid. */
const router = useRouter();
const branches = useBranchesStore();

const status = ref('');
const from = ref('');
const to = ref('');

const sales = usePaginatedResource<Sale>(
  (params, signal) =>
    saleService.list(
      {
        ...params,
        ...(status.value ? { status: status.value as Sale['status'] } : {}),
        ...(from.value ? { from: new Date(from.value).toISOString() } : {}),
        ...(to.value ? { to: new Date(`${to.value}T23:59:59`).toISOString() } : {}),
        ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      },
      { signal },
    ),
  {
    watchSources: [
      () => status.value,
      () => from.value,
      () => to.value,
      () => branches.scopeBranchId,
    ],
  },
);

const columns: TableColumn[] = [
  { key: 'number', label: 'Receipt' },
  { key: 'soldAt', label: 'When', hideOnMobile: true },
  { key: 'items', label: 'Items', align: 'right', hideOnMobile: true },
  { key: 'total', label: 'Total', align: 'right' },
  { key: 'payment', label: 'Payment', align: 'right' },
];

const PAYMENT_TONES = { paid: 'positive', partial: 'warning', unpaid: 'danger' } as const;
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-5">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Sales</h2>
      <p class="mt-1 text-sm text-ink-500">Every receipt, newest first.</p>
    </div>

    <div class="grid gap-3 sm:grid-cols-3">
      <BaseSelect
        v-model="status"
        label="Status"
        :options="SALE_STATUSES.map((value) => ({ value, label: value }))"
        placeholder="All statuses"
      />
      <BaseInput v-model="from" label="From" type="date" />
      <BaseInput v-model="to" label="To" type="date" />
    </div>

    <DataTable
      :columns="columns"
      :rows="sales.items.value"
      :loading="sales.isLoading.value"
      :error="sales.error.value"
      :pagination="sales.pagination.value"
      selectable
      caption="Sales"
      empty-title="No sales in this range"
      empty-description="Change the dates, or ring one up at the till."
      @retry="sales.reload()"
      @page="sales.goToPage"
      @select="(sale) => router.push({ name: 'sale-detail', params: { id: sale.id } })"
    >
      <template #cell-number="{ row }">
        <p class="font-medium text-ink-900">{{ row.number }}</p>
        <p class="text-xs text-ink-500 sm:hidden">{{ formatDateTime(row.soldAt) }}</p>
        <BaseBadge v-if="row.status === 'cancelled'" tone="danger">Cancelled</BaseBadge>
      </template>

      <template #cell-soldAt="{ row }">
        <span class="text-xs text-ink-500">{{ formatDateTime(row.soldAt) }}</span>
      </template>

      <template #cell-items="{ row }">{{ row.items.length }}</template>

      <template #cell-total="{ row }">
        <span class="font-medium text-ink-900">{{ formatMoney(row.totals.grandTotal) }}</span>
        <span v-if="row.totals.dueAmount > 0" class="block text-xs text-warning-700">
          {{ formatMoney(row.totals.dueAmount) }} owed
        </span>
      </template>

      <template #cell-payment="{ row }">
        <BaseBadge :tone="PAYMENT_TONES[row.paymentStatus]" dot>{{ row.paymentStatus }}</BaseBadge>
      </template>
    </DataTable>
  </div>
</template>
