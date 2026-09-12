<script setup lang="ts">
import {
  EXPENSE_CATEGORY_LABELS,
  formatMoney,
  type AnalyticsDashboard,
  type AnalyticsPeriodKey,
} from '@hadiya/shared';
import { computed, onMounted, ref, watch } from 'vue';
import { RouterLink } from 'vue-router';

import BaseCard from '@/components/ui/BaseCard.vue';
import { analyticsService } from '@/services/analytics.service';

/**
 * The shop at a glance.
 *
 * A deliberate exception to this app's rule that Billz owns the screens: a
 * person opening Hadiya in the morning wants the day's position before they
 * want a conversation, and asking for it in chat every morning is a worse
 * version of a page that is simply already there.
 *
 * Every figure is the one the assistant would quote for the same period,
 * because both read the same analytics service over the same window. What the
 * page must never do is fill a gap with arithmetic of its own: where a number
 * has no source — margin, marketing spend — it says so instead of showing one.
 */
const PERIODS: { key: AnalyticsPeriodKey; label: string }[] = [
  { key: 'today', label: 'Bugun' },
  { key: 'this_week', label: 'Shu hafta' },
  { key: 'this_month', label: 'Shu oy' },
  { key: 'this_quarter', label: 'Chorak' },
];

const period = ref<AnalyticsPeriodKey>('this_month');
const data = ref<AnalyticsDashboard | null>(null);
const loading = ref(true);
const failure = ref<string | null>(null);

const load = async (): Promise<void> => {
  loading.value = true;
  failure.value = null;

  try {
    data.value = await analyticsService.dashboard({ period: period.value });
  } catch (error) {
    failure.value =
      error instanceof Error ? error.message : 'Ma’lumotni olib bo‘lmadi. Qayta urinib ko‘ring.';
  } finally {
    loading.value = false;
  }
};

onMounted(load);
watch(period, load);

/** Figures arrive in tiyin; the tile shows so'm. */
const money = (value: number): string =>
  formatMoney(value, { currency: data.value?.currency ?? 'UZS' });

const count = (value: number): string => new Intl.NumberFormat('uz-UZ').format(value);

const change = computed(() => {
  const changes = data.value?.comparison?.changes ?? [];

  return (metric: string): { percent: number; direction: string } | null => {
    const found = changes.find((entry) => entry.metric === metric);

    return found === undefined || found.percentageChange === null
      ? null
      : { percent: found.percentageChange, direction: found.direction };
  };
});

const topBrand = computed(() => data.value?.topProducts[0] ?? null);
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Do‘kon holati</h2>
        <p class="mt-1 text-sm text-ink-500">
          {{ data ? `${data.period.from} — ${data.period.to}` : 'Billz’dan o‘qilmoqda…' }}
        </p>
      </div>

      <div class="flex gap-1 rounded-lg bg-surface p-1 ring-1 ring-border-subtle">
        <button
          v-for="option in PERIODS"
          :key="option.key"
          type="button"
          class="rounded-md px-3 py-1.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          :class="
            period === option.key
              ? 'bg-brand-600 text-white'
              : 'text-ink-500 hover:bg-border-subtle/40 hover:text-ink-900'
          "
          @click="period = option.key"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <p v-if="failure" class="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">
      {{ failure }}
    </p>

    <div v-if="data" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Sof savdo</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {{ money(data.metrics.netSales) }}
        </p>
        <p v-if="change('netSales')" class="mt-1 text-xs text-ink-500">
          o‘tgan davrga nisbatan {{ change('netSales')?.percent.toFixed(0) }}%
        </p>
      </BaseCard>

      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Cheklar</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {{ count(data.metrics.saleCount) }}
        </p>
        <p class="mt-1 text-xs text-ink-500">{{ count(data.metrics.unitsSold) }} dona sotilgan</p>
      </BaseCard>

      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">O‘rtacha chek</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {{ money(data.metrics.averageOrderValue) }}
        </p>
      </BaseCard>

      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Qarzdorlik</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {{ money(data.metrics.outstandingDebt) }}
        </p>
        <p v-if="data.metrics.returnsTotal > 0" class="mt-1 text-xs text-ink-500">
          qaytarilgan {{ money(data.metrics.returnsTotal) }}
        </p>
      </BaseCard>
    </div>

    <div v-if="data" class="grid gap-4 lg:grid-cols-2">
      <BaseCard
        title="Eng ko‘p sotilganlar"
        :description="topBrand ? `Yetakchi: ${topBrand.name}` : undefined"
      >
        <p v-if="data.topProducts.length === 0" class="text-sm text-ink-500">
          Bu davrda savdo bo‘lmagan.
        </p>
        <ul v-else class="flex flex-col divide-y divide-border-subtle">
          <li
            v-for="item in data.topProducts"
            :key="item.externalId ?? item.name"
            class="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
          >
            <span class="text-sm text-ink-900">{{ item.name }}</span>
            <span class="whitespace-nowrap text-sm tabular-nums text-ink-500">
              {{ count(item.units) }} dona · {{ money(item.revenue) }}
            </span>
          </li>
        </ul>
      </BaseCard>

      <BaseCard title="Tugayotgan tovar" description="Zaxira kam qolgan mahsulotlar">
        <p v-if="data.lowStock.length === 0" class="text-sm text-ink-500">
          Hech narsa chegaradan pastga tushmagan.
        </p>
        <ul v-else class="flex flex-col divide-y divide-border-subtle">
          <li
            v-for="row in data.lowStock"
            :key="`${row.sku}-${row.shopName}`"
            class="flex items-baseline justify-between gap-4 py-2 first:pt-0 last:pb-0"
          >
            <span class="text-sm text-ink-900">{{ row.productName }}</span>
            <span class="whitespace-nowrap text-sm font-medium tabular-nums text-amber-700">
              {{ count(row.quantity) }} dona
            </span>
          </li>
        </ul>
      </BaseCard>
    </div>

    <div v-if="data" class="grid gap-4 sm:grid-cols-2">
      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Xarajatlar</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {{ money(data.expenses.total) }}
        </p>
        <p class="mt-1 text-xs text-ink-500">
          <RouterLink :to="{ name: 'expenses' }" class="underline-offset-2 hover:underline">
            {{ count(data.expenses.count) }} ta yozuv
          </RouterLink>
          <template v-if="data.expenses.byCategory[0]">
            · eng kattasi {{ EXPENSE_CATEGORY_LABELS[data.expenses.byCategory[0].category] }}
          </template>
        </p>
      </BaseCard>

      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">
          Xarajatlardan keyin qolgan
        </p>
        <p
          class="mt-1 text-2xl font-semibold tabular-nums"
          :class="data.netAfterExpenses < 0 ? 'text-rose-700' : 'text-ink-900'"
        >
          {{ money(data.netAfterExpenses) }}
        </p>
        <!-- Not a profit figure: cost of goods sold is still unknown. -->
        <p class="mt-1 text-xs text-ink-500">sof savdo minus yozilgan xarajatlar; foyda emas</p>
      </BaseCard>
    </div>

    <BaseCard v-if="data" title="Hali ulanmagan" description="Bu ko‘rsatkichlar uchun manba yo‘q">
      <ul class="flex flex-col gap-1 text-sm text-ink-500">
        <li>
          <span class="font-medium text-ink-900">Yalpi foyda</span> — sotilgan tovar tannarxi kerak.
          Billz API kaliti
          <code class="rounded bg-border-subtle/40 px-1">/v1/gl-transaction</code> ga 403 qaytaradi;
          yozilgan xarajatlar buning o‘rnini bosmaydi.
        </li>
        <li>
          <span class="font-medium text-ink-900">Marketing sarfi</span> — Meta reklama ulanmagan.
        </li>
        <li>
          <span class="font-medium text-ink-900">Lidlar va yopilgan savdolar</span> — amoCRM
          ulanmagan.
        </li>
      </ul>
    </BaseCard>

    <p v-if="loading" class="text-sm text-ink-500">Yangilanmoqda…</p>

    <p v-if="data && !data.dataQuality.complete" class="text-sm text-amber-700">
      Diqqat: bu davr uchun cheklarning bir qismi o‘qilmadi, shuning uchun raqamlar to‘liq emas.
    </p>
  </div>
</template>
