<script setup lang="ts">
import { formatMoney, type Expense, type Sale } from '@hadiya/shared';
import { computed, onMounted, ref } from 'vue';

import MetricCard from '@/components/dashboard/MetricCard.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { toErrorMessage } from '@/services/api-error';
import { expenseService } from '@/services/expense.service';
import { saleService } from '@/services/sales.service';
import { useBranchesStore } from '@/stores/branches';
import { formatDate } from '@/utils/format';

/**
 * Reporting over a chosen range.
 *
 * There is no reporting endpoint yet, so this aggregates the sale and expense
 * records the API returns. That has a real ceiling — one page of each — and the
 * page says so plainly rather than presenting a partial sum as a total. A
 * server-side aggregate is the right fix and belongs in the API, not here.
 *
 * The daily chart is drawn as inline SVG rather than pulling in a charting
 * library: one bar series over at most a few dozen days does not justify the
 * dependency, and this way it inherits the theme tokens for free.
 */
const branches = useBranchesStore();

const PAGE_LIMIT = 100;

const today = new Date();
const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);

const from = ref(startOfMonth.toISOString().slice(0, 10));
const to = ref(today.toISOString().slice(0, 10));

const sales = ref<Sale[]>([]);
const expenses = ref<Expense[]>([]);
const saleTotal = ref(0);
const expenseTotal = ref(0);
const isLoading = ref(false);
const error = ref<string | null>(null);
const truncated = ref(false);

const load = async (): Promise<void> => {
  isLoading.value = true;
  error.value = null;

  const range = {
    from: new Date(from.value).toISOString(),
    to: new Date(`${to.value}T23:59:59`).toISOString(),
    ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
  };

  try {
    const [saleResult, expenseResult] = await Promise.all([
      saleService.list({ ...range, status: 'completed', pageSize: PAGE_LIMIT }),
      expenseService.list({ ...range, status: 'approved', pageSize: PAGE_LIMIT }),
    ]);

    sales.value = saleResult.items;
    expenses.value = expenseResult.items;
    saleTotal.value = saleResult.pagination.total;
    expenseTotal.value = expenseResult.pagination.total;
    truncated.value =
      saleResult.pagination.total > saleResult.items.length ||
      expenseResult.pagination.total > expenseResult.items.length;
  } catch (caught) {
    error.value = toErrorMessage(caught);
    sales.value = [];
    expenses.value = [];
  } finally {
    isLoading.value = false;
  }
};

const revenue = computed(() =>
  sales.value.reduce((total, sale) => total + sale.totals.grandTotal, 0),
);

const collected = computed(() =>
  sales.value.reduce((total, sale) => total + sale.totals.paidAmount, 0),
);

const outstanding = computed(() =>
  sales.value.reduce((total, sale) => total + sale.totals.dueAmount, 0),
);

const costOfGoods = computed(() =>
  sales.value.reduce(
    (total, sale) =>
      total + sale.items.reduce((cost, line) => cost + line.costPrice * line.quantity, 0),
    0,
  ),
);

const spent = computed(() => expenses.value.reduce((total, expense) => total + expense.amount, 0));

/** Revenue less cost of goods and the approved expenses in the same range. */
const netMargin = computed(() => revenue.value - costOfGoods.value - spent.value);

interface DailyPoint {
  day: string;
  revenue: number;
}

const daily = computed<DailyPoint[]>(() => {
  const byDay = new Map<string, number>();

  for (const sale of sales.value) {
    const day = sale.soldAt.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + sale.totals.grandTotal);
  }

  return [...byDay.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([day, value]) => ({ day, revenue: value }));
});

const peak = computed(() => Math.max(1, ...daily.value.map((point) => point.revenue)));

const topProducts = computed(() => {
  const byProduct = new Map<string, { name: string; sku: string; quantity: number; revenue: number }>();

  for (const sale of sales.value) {
    for (const line of sale.items) {
      const entry = byProduct.get(line.product) ?? {
        name: line.name,
        sku: line.sku,
        quantity: 0,
        revenue: 0,
      };

      entry.quantity += line.quantity;
      entry.revenue += line.lineTotal;
      byProduct.set(line.product, entry);
    }
  }

  return [...byProduct.values()].sort((left, right) => right.revenue - left.revenue).slice(0, 10);
});

const expensesByCategory = computed(() => {
  const byCategory = new Map<string, number>();

  for (const expense of expenses.value) {
    byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
  }

  return [...byCategory.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount);
});

const customersServed = computed(() => {
  const identified = new Set(sales.value.filter((sale) => sale.customer).map((sale) => sale.customer));

  return { identified: identified.size, walkIn: sales.value.filter((sale) => !sale.customer).length };
});

onMounted(load);
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-5">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Reports</h2>
      <p class="mt-1 text-sm text-ink-500">
        Completed sales and approved expenses over a chosen range.
      </p>
    </div>

    <div class="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <BaseInput v-model="from" label="From" type="date" />
      <BaseInput v-model="to" label="To" type="date" />
      <BaseButton :loading="isLoading" @click="load">Run report</BaseButton>
    </div>

    <LoadingSkeleton v-if="isLoading" variant="card" :rows="2" />
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else>
      <p
        v-if="truncated"
        class="rounded-lg bg-warning-50 px-4 py-3 text-sm text-warning-700 ring-1 ring-warning-600/30"
      >
        This range holds more than {{ PAGE_LIMIT }} records. The figures below cover the most recent
        {{ PAGE_LIMIT }} sales and expenses, so treat them as a floor rather than a total.
      </p>

      <section aria-label="Range totals" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Revenue"
          :value="formatMoney(revenue)"
          :caption="`${saleTotal} completed sale(s)`"
        />
        <MetricCard label="Collected" :value="formatMoney(collected)" caption="Payments taken" />
        <MetricCard
          label="Outstanding"
          :value="formatMoney(outstanding)"
          caption="Still owed on these sales"
          :tone="outstanding > 0 ? 'warning' : 'default'"
        />
        <MetricCard
          label="Net margin"
          :value="formatMoney(netMargin)"
          caption="Revenue less cost of goods and approved expenses"
        />
      </section>

      <BaseCard title="Revenue by day" description="Completed sales in the range">
        <EmptyState
          v-if="daily.length === 0"
          title="No sales in this range"
          description="Widen the dates to see something here."
        />
        <div v-else class="overflow-x-auto">
          <div class="flex min-w-max items-end gap-2" role="img" aria-label="Revenue by day">
            <div v-for="point in daily" :key="point.day" class="flex w-12 flex-col items-center gap-1">
              <span class="text-[0.625rem] tabular-nums text-ink-500">
                {{ Math.round(point.revenue / 100) }}
              </span>
              <div
                class="w-full rounded-t bg-brand-600"
                :style="{ height: `${Math.max(4, (point.revenue / peak) * 140)}px` }"
                :title="`${point.day}: ${formatMoney(point.revenue)}`"
              />
              <span class="text-[0.625rem] text-ink-500">{{ point.day.slice(8) }}</span>
            </div>
          </div>
          <p class="mt-2 text-xs text-ink-500">Bar labels are in whole currency units.</p>
        </div>
      </BaseCard>

      <div class="grid gap-5 lg:grid-cols-2">
        <BaseCard title="Top products" description="By revenue in the range">
          <EmptyState v-if="topProducts.length === 0" title="Nothing sold in this range" />
          <ul v-else class="divide-y divide-border-subtle">
            <li
              v-for="product in topProducts"
              :key="product.sku"
              class="flex justify-between gap-4 py-2 first:pt-0 last:pb-0"
            >
              <div class="min-w-0">
                <p class="truncate text-sm text-ink-900">{{ product.name }}</p>
                <p class="font-mono text-xs text-ink-500">{{ product.sku }}</p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-sm tabular-nums text-ink-900">{{ formatMoney(product.revenue) }}</p>
                <p class="text-xs tabular-nums text-ink-500">×{{ product.quantity }}</p>
              </div>
            </li>
          </ul>
        </BaseCard>

        <BaseCard title="Expenses by category" :description="`${expenseTotal} approved expense(s)`">
          <EmptyState v-if="expensesByCategory.length === 0" title="No approved expenses" />
          <ul v-else class="flex flex-col gap-2">
            <li v-for="entry in expensesByCategory" :key="entry.category">
              <div class="flex justify-between text-sm">
                <span class="text-ink-700">{{ entry.category }}</span>
                <span class="tabular-nums text-ink-900">{{ formatMoney(entry.amount) }}</span>
              </div>
              <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-muted">
                <div
                  class="h-full rounded-full bg-warning-600"
                  :style="{ width: `${(entry.amount / Math.max(1, spent)) * 100}%` }"
                />
              </div>
            </li>
          </ul>
        </BaseCard>

        <BaseCard title="Customers" description="Who these sales were for">
          <dl class="grid grid-cols-2 gap-4">
            <div>
              <dt class="text-xs uppercase tracking-wide text-ink-500">Named customers</dt>
              <dd class="mt-1 text-xl font-semibold tabular-nums text-ink-900">
                {{ customersServed.identified }}
              </dd>
            </div>
            <div>
              <dt class="text-xs uppercase tracking-wide text-ink-500">Walk-in sales</dt>
              <dd class="mt-1 text-xl font-semibold tabular-nums text-ink-900">
                {{ customersServed.walkIn }}
              </dd>
            </div>
          </dl>
        </BaseCard>

        <BaseCard title="Cost of goods" description="From the cost recorded on each sale line">
          <p class="text-2xl font-semibold tabular-nums text-ink-900">
            {{ formatMoney(costOfGoods) }}
          </p>
          <p class="mt-1 text-sm text-ink-500">
            Gross margin {{ formatMoney(revenue - costOfGoods) }} before expenses.
          </p>
        </BaseCard>
      </div>
    </template>
  </div>
</template>
