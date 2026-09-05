<script setup lang="ts">
import { formatMoney } from '@hadiya/shared';
import { onMounted, watch } from 'vue';

import MetricCard from '@/components/dashboard/MetricCard.vue';
import UpcomingReminders from '@/components/reminders/UpcomingReminders.vue';
import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { useDashboard } from '@/composables/useDashboard';
import { useBranchesStore } from '@/stores/branches';
import { formatDateTime } from '@/utils/format';

/**
 * Today, from real records.
 *
 * Every figure is computed from sales and expenses the API returned; nothing is
 * estimated or filled in. Net profit is deliberately absent — it would need
 * expenses attributed to the same period and branch, which the API does not do,
 * so gross margin is shown and named as such.
 */
const branches = useBranchesStore();
const dashboard = useDashboard(() => branches.scopeBranchId);

onMounted(() => void dashboard.load());
watch(
  () => branches.scopeBranchId,
  () => void dashboard.load(),
);
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Today</h2>
        <p class="mt-1 text-sm text-ink-500">
          Completed sales and approved expenses recorded today{{
            branches.selectedBranch ? ` at ${branches.selectedBranch.name}` : ''
          }}.
        </p>
      </div>
      <BaseButton
        variant="secondary"
        size="sm"
        :loading="dashboard.isLoading.value"
        @click="dashboard.load()"
      >
        Refresh
      </BaseButton>
    </div>

    <LoadingSkeleton
      v-if="dashboard.isLoading.value && !dashboard.hasData.value"
      variant="card"
      :rows="2"
    />

    <ErrorState
      v-else-if="dashboard.error.value"
      :message="dashboard.error.value"
      @retry="dashboard.load()"
    />

    <template v-else-if="dashboard.data.value">
      <section aria-label="Today's figures" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Sales"
          :value="String(dashboard.data.value.metrics.saleCount)"
          :caption="`${dashboard.data.value.metrics.itemsSold} item(s) sold`"
        />
        <MetricCard
          label="Revenue"
          :value="formatMoney(dashboard.data.value.metrics.revenue)"
          caption="Billed on completed sales"
        />
        <MetricCard
          label="Collected"
          :value="formatMoney(dashboard.data.value.metrics.collected)"
          :caption="
            dashboard.data.value.metrics.outstanding > 0
              ? `${formatMoney(dashboard.data.value.metrics.outstanding)} still owed`
              : 'Everything paid'
          "
          :tone="dashboard.data.value.metrics.outstanding > 0 ? 'warning' : 'default'"
        />
        <MetricCard
          label="Gross margin"
          :value="formatMoney(dashboard.data.value.metrics.grossMargin)"
          caption="Revenue less cost of goods sold"
        />
      </section>

      <section class="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="Approved expenses"
          :value="formatMoney(dashboard.data.value.metrics.expenses)"
          caption="Recorded and approved today"
        />
        <MetricCard
          label="Low stock"
          :value="String(dashboard.data.value.lowStock.length)"
          caption="Products at or below 5 units"
          :tone="dashboard.data.value.lowStock.length > 0 ? 'warning' : 'default'"
        />
      </section>

      <p v-if="dashboard.data.value.truncated" class="text-xs text-warning-700">
        More than 100 sales today; the totals above cover the most recent 100.
      </p>

      <div class="grid gap-6 lg:grid-cols-2">
        <BaseCard title="Recent sales" description="Most recent first">
          <EmptyState
            v-if="dashboard.data.value.recentSales.length === 0"
            title="No sales yet today"
            description="Completed sales appear here as they are rung up."
          />
          <ul v-else class="divide-y divide-border-subtle">
            <li
              v-for="sale in dashboard.data.value.recentSales"
              :key="sale.id"
              class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <div class="min-w-0">
                <RouterLink
                  :to="{ name: 'sale-detail', params: { id: sale.id } }"
                  class="truncate text-sm font-medium text-ink-900 hover:text-brand-700"
                >
                  {{ sale.number }}
                </RouterLink>
                <p class="text-xs text-ink-500">{{ formatDateTime(sale.soldAt) }}</p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-sm font-medium tabular-nums text-ink-900">
                  {{ formatMoney(sale.totals.grandTotal) }}
                </p>
                <BaseBadge :tone="sale.totals.dueAmount > 0 ? 'warning' : 'positive'">
                  {{ sale.paymentStatus }}
                </BaseBadge>
              </div>
            </li>
          </ul>
        </BaseCard>

        <BaseCard title="Top products today" description="By revenue">
          <EmptyState
            v-if="dashboard.data.value.topProducts.length === 0"
            title="Nothing sold yet"
            description="The best sellers of the day will show here."
          />
          <ul v-else class="divide-y divide-border-subtle">
            <li
              v-for="product in dashboard.data.value.topProducts"
              :key="product.productId"
              class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-ink-900">{{ product.name }}</p>
                <p class="text-xs text-ink-500">{{ product.sku }}</p>
              </div>
              <div class="shrink-0 text-right">
                <p class="text-sm font-medium tabular-nums text-ink-900">
                  {{ formatMoney(product.revenue) }}
                </p>
                <p class="text-xs tabular-nums text-ink-500">×{{ product.quantity }}</p>
              </div>
            </li>
          </ul>
        </BaseCard>

        <BaseCard title="Low stock" description="At or below 5 units">
          <EmptyState
            v-if="dashboard.data.value.lowStock.length === 0"
            title="Stock looks healthy"
            description="Nothing is running low right now."
          />
          <ul v-else class="divide-y divide-border-subtle">
            <li
              v-for="entry in dashboard.data.value.lowStock"
              :key="entry.item.id"
              class="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"
            >
              <p class="min-w-0 truncate text-sm text-ink-900">
                {{ entry.product?.name ?? 'Unknown product' }}
                <span v-if="entry.product" class="text-ink-500">· {{ entry.product.sku }}</span>
              </p>
              <BaseBadge :tone="entry.item.quantity <= 0 ? 'danger' : 'warning'">
                {{ entry.item.quantity }} left
              </BaseBadge>
            </li>
          </ul>
        </BaseCard>

        <UpcomingReminders />
      </div>
    </template>
  </div>
</template>
