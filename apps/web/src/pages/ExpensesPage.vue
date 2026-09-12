<script setup lang="ts">
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_MAX_AMOUNT,
  EXPENSE_NOTE_MAX_LENGTH,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_VENDOR_MAX_LENGTH,
  formatMoney,
  toMinorUnits,
  type Expense,
  type ExpenseCategory,
  type ExpensePaymentMethod,
  type ExpenseSummary,
} from '@hadiya/shared';
import { computed, onMounted, reactive, ref } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BasePagination from '@/components/ui/BasePagination.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { expenseService } from '@/services/expense.service';

/**
 * The expense ledger.
 *
 * The one screen in Hadiya that *writes* a business figure rather than reading
 * one from Billz. Billz refuses to share its costs (`/v1/gl-transaction`, 403),
 * so what the shop spends is recorded here — by hand on this page, or by the
 * assistant from a sentence — and the dashboard subtracts it from the takings.
 *
 * Amounts are typed in whole so'm, because that is how a person reads a
 * receipt, and multiplied into tiyin here before the payload is built. The
 * service below sends exactly what it is given, so this is the only place the
 * conversion happens on the way in.
 */
const toast = useToast();

const PAYMENT_LABELS: Record<ExpensePaymentMethod, string> = {
  cash: 'Naqd',
  card: 'Karta',
  transfer: 'O‘tkazma',
};

const categoryOptions = EXPENSE_CATEGORIES.map((category) => ({
  value: category,
  label: EXPENSE_CATEGORY_LABELS[category],
}));

const paymentOptions = EXPENSE_PAYMENT_METHODS.map((method) => ({
  value: method,
  label: PAYMENT_LABELS[method],
}));

/** Today as the local `YYYY-MM-DD`, the form's default date. */
const today = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, '0');

  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

// --- Recording -------------------------------------------------------------

const form = reactive({
  category: 'goods' as ExpenseCategory,
  amount: '',
  date: today(),
  paymentMethod: 'cash' as ExpensePaymentMethod,
  vendor: '',
  note: '',
});

const isSaving = ref(false);
const formError = ref<string | null>(null);

/** Whole so'm as typed — "120 000" or "120000" — or `null` when it is not a sum. */
const parsedAmount = computed((): number | null => {
  const digits = form.amount.replace(/[\s_']/g, '');

  if (!/^\d+$/.test(digits)) {
    return null;
  }

  const minor = toMinorUnits(Number(digits));

  return minor >= 1 && minor <= EXPENSE_MAX_AMOUNT ? minor : null;
});

const submit = async (): Promise<void> => {
  formError.value = null;

  if (parsedAmount.value === null) {
    formError.value = 'Summani butun so‘mda kiriting, masalan 120000.';

    return;
  }

  isSaving.value = true;

  try {
    const expense = await expenseService.create({
      category: form.category,
      amount: parsedAmount.value,
      date: form.date,
      paymentMethod: form.paymentMethod,
      vendor: form.vendor.trim() || null,
      note: form.note.trim() || null,
    });

    toast.success(`${money(expense.amount)} yozildi.`);
    form.amount = '';
    form.vendor = '';
    form.note = '';
    // The category, date and payment method stay: a person entering the
    // month's receipts changes them rarely and the amount every time.

    await Promise.all([reload(), loadSummary()]);
  } catch (caught) {
    formError.value = toErrorMessage(caught);
  } finally {
    isSaving.value = false;
  }
};

// --- The ledger -------------------------------------------------------------

const filterCategory = ref<ExpenseCategory | ''>('');

const { items, pagination, isLoading, error, reload, goToPage } = usePaginatedResource<Expense>(
  ({ page, pageSize }, signal) =>
    expenseService.list(
      {
        page,
        pageSize,
        ...(filterCategory.value ? { category: filterCategory.value } : {}),
      },
      signal,
    ),
  { watchSources: [() => filterCategory.value] },
);

const summary = ref<ExpenseSummary | null>(null);

const loadSummary = async (): Promise<void> => {
  try {
    summary.value = await expenseService.summary({ period: 'this_month' });
  } catch {
    // The totals are a convenience above the list; a failed read leaves the
    // strip empty rather than blocking the ledger the person came to use.
    summary.value = null;
  }
};

onMounted(loadSummary);

const money = (minor: number): string => formatMoney(minor);

const topCategory = computed(() => summary.value?.byCategory[0] ?? null);

// --- Removal ----------------------------------------------------------------

const pendingRemoval = ref<Expense | null>(null);
const isRemoving = ref(false);
const confirmOpen = computed({
  get: () => pendingRemoval.value !== null,
  set: (open: boolean) => {
    if (!open) {
      pendingRemoval.value = null;
    }
  },
});

const remove = async (): Promise<void> => {
  const target = pendingRemoval.value;

  if (target === null) {
    return;
  }

  isRemoving.value = true;

  try {
    await expenseService.remove(target.id);
    toast.success(`${money(target.amount)} o‘chirildi.`);
    pendingRemoval.value = null;
    await Promise.all([reload(), loadSummary()]);
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isRemoving.value = false;
  }
};

const describe = (expense: Expense): string =>
  [expense.vendor, expense.note].filter((part): part is string => Boolean(part)).join(' — ');
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Xarajatlar</h2>
      <p class="mt-1 text-sm text-ink-500">
        Bu yerga yozing, yoki yordamchiga ayting — “ijaraga 3 million to‘ladim”. Billz xarajatlarni
        bermaydi, shuning uchun ular shu yerda saqlanadi.
      </p>
    </div>

    <div v-if="summary" class="grid gap-4 sm:grid-cols-3" data-testid="expense-summary">
      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Shu oy</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums text-ink-900">
          {{ money(summary.total) }}
        </p>
        <p class="mt-1 text-xs text-ink-500">{{ summary.count }} ta yozuv</p>
      </BaseCard>

      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Eng katta ulush</p>
        <p v-if="topCategory" class="mt-1 text-2xl font-semibold text-ink-900">
          {{ EXPENSE_CATEGORY_LABELS[topCategory.category] }}
        </p>
        <p v-if="topCategory" class="mt-1 text-xs tabular-nums text-ink-500">
          {{ money(topCategory.total) }}
          <template v-if="topCategory.share !== null">
            · {{ topCategory.share.toFixed(0) }}%</template
          >
        </p>
        <p v-else class="mt-1 text-sm text-ink-500">Hali yozuv yo‘q.</p>
      </BaseCard>

      <BaseCard>
        <p class="text-xs font-medium uppercase tracking-wide text-ink-500">Davr</p>
        <p class="mt-1 text-sm text-ink-900">{{ summary.period.from }} — {{ summary.period.to }}</p>
        <p class="mt-1 text-xs text-ink-500">{{ summary.period.label }}</p>
      </BaseCard>
    </div>

    <BaseCard title="Yangi xarajat" description="Summa butun so‘mda; sana — to‘lov qilingan kun">
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <BaseSelect v-model="form.category" label="Turi" :options="categoryOptions" required />

          <BaseInput
            v-model="form.amount"
            label="Summa (so‘m)"
            inputmode="numeric"
            placeholder="120000"
            required
            :error="formError"
          />

          <BaseInput v-model="form.date" label="Sana" type="date" required />

          <BaseSelect
            v-model="form.paymentMethod"
            label="To‘lov usuli"
            :options="paymentOptions"
            required
          />

          <BaseInput
            v-model="form.vendor"
            label="Kimga"
            placeholder="Elektr tarmoqlari"
            :maxlength="EXPENSE_VENDOR_MAX_LENGTH"
          />

          <BaseInput
            v-model="form.note"
            label="Izoh"
            placeholder="Ixtiyoriy"
            :maxlength="EXPENSE_NOTE_MAX_LENGTH"
          />
        </div>

        <div class="flex items-center gap-3">
          <BaseButton type="submit" :loading="isSaving">Yozib qo‘yish</BaseButton>
          <p v-if="parsedAmount !== null" class="text-sm tabular-nums text-ink-500">
            {{ money(parsedAmount) }}
          </p>
        </div>
      </form>
    </BaseCard>

    <BaseCard title="Yozuvlar" description="Oxirgisi yuqorida">
      <div class="mb-4 max-w-xs">
        <BaseSelect
          v-model="filterCategory"
          label="Turi bo‘yicha"
          :options="categoryOptions"
          placeholder="Barcha turlar"
        />
      </div>

      <p v-if="error" class="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700">{{ error }}</p>

      <EmptyState
        v-else-if="!isLoading && items.length === 0"
        title="Hali xarajat yozilmagan"
        description="Birinchisini yuqoridagi shakl orqali yoki yordamchiga aytib yozing."
      />

      <ul v-else class="flex flex-col divide-y divide-border-subtle" data-testid="expense-list">
        <li
          v-for="expense in items"
          :key="expense.id"
          class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0"
        >
          <div class="flex min-w-0 flex-col">
            <span class="text-sm font-medium text-ink-900">
              {{ EXPENSE_CATEGORY_LABELS[expense.category] }}
              <span v-if="describe(expense)" class="font-normal text-ink-500">
                · {{ describe(expense) }}
              </span>
            </span>
            <span class="text-xs text-ink-500">
              {{ expense.date }} · {{ PAYMENT_LABELS[expense.paymentMethod] }}
            </span>
          </div>

          <div class="flex items-center gap-3">
            <span class="whitespace-nowrap text-sm font-semibold tabular-nums text-ink-900">
              {{ money(expense.amount) }}
            </span>
            <BaseButton
              variant="ghost"
              size="sm"
              :aria-label="`${money(expense.amount)} ni o‘chirish`"
              @click="pendingRemoval = expense"
            >
              O‘chirish
            </BaseButton>
          </div>
        </li>
      </ul>

      <p v-if="isLoading" class="mt-3 text-sm text-ink-500">Yuklanmoqda…</p>

      <BasePagination :pagination="pagination" :disabled="isLoading" @change="goToPage" />
    </BaseCard>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Xarajatni o‘chirish"
      :message="
        pendingRemoval
          ? `${money(pendingRemoval.amount)} (${EXPENSE_CATEGORY_LABELS[pendingRemoval.category]}, ${pendingRemoval.date}) hisobdan chiqariladi.`
          : ''
      "
      confirm-label="O‘chirish"
      cancel-label="Bekor qilish"
      :busy="isRemoving"
      @confirm="remove"
    />
  </div>
</template>
