<script setup lang="ts">
import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  formatMoney,
  type Expense,
  type ExpenseCategory,
} from '@hadiya/shared';
import { computed, reactive, ref } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { usePermissions } from '@/composables/usePermissions';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { expenseService } from '@/services/expense.service';
import { useBranchesStore } from '@/stores/branches';
import { formatDate } from '@/utils/format';

/**
 * What the shop spent.
 *
 * The total below the table is the total of *this page*, and says so. The API
 * has no aggregate endpoint, and quietly presenting one page's sum as the
 * period total would be a fabricated figure — the kind that gets acted on.
 */
const { canReviewExpenses } = usePermissions();
const toast = useToast();
const branches = useBranchesStore();

const category = ref('');
const status = ref('');
const from = ref('');
const to = ref('');

const expenses = usePaginatedResource<Expense>(
  (params, signal) =>
    expenseService.list(
      {
        ...params,
        ...(category.value ? { category: category.value as ExpenseCategory } : {}),
        ...(status.value ? { status: status.value as Expense['status'] } : {}),
        ...(from.value ? { from: new Date(from.value).toISOString() } : {}),
        ...(to.value ? { to: new Date(`${to.value}T23:59:59`).toISOString() } : {}),
        ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      },
      { signal },
    ),
  {
    watchSources: [
      () => category.value,
      () => status.value,
      () => from.value,
      () => to.value,
      () => branches.scopeBranchId,
    ],
  },
);

const pageTotal = computed(() =>
  expenses.items.value.reduce((total, expense) => total + expense.amount, 0),
);

const columns: TableColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'category', label: 'Category' },
  { key: 'description', label: 'Description', hideOnMobile: true },
  { key: 'amount', label: 'Amount', align: 'right' },
  { key: 'status', label: 'Status', align: 'right' },
];

const STATUS_TONES = {
  pending: 'warning',
  approved: 'positive',
  rejected: 'danger',
  paid: 'brand',
} as const;

const isFormOpen = ref(false);
const editing = ref<Expense | null>(null);
const isSubmitting = ref(false);
const formError = ref<string | null>(null);
const form = reactive({ category: 'other', amount: '', description: '', date: '' });
const amountError = ref<string | null>(null);

const openForm = (expense: Expense | null): void => {
  editing.value = expense;
  form.category = expense?.category ?? EXPENSE_CATEGORIES[0];
  form.amount = expense ? (expense.amount / 100).toFixed(2) : '';
  form.description = expense?.description ?? '';
  form.date = (expense?.date ?? new Date().toISOString()).slice(0, 10);
  amountError.value = null;
  formError.value = null;
  isFormOpen.value = true;
};

const submit = async (): Promise<void> => {
  if (isSubmitting.value) {
    return;
  }

  const amount = Math.round(Number.parseFloat(form.amount || '0') * 100);
  amountError.value = Number.isFinite(amount) && amount > 0 ? null : 'Enter an amount above zero';

  if (amountError.value) {
    return;
  }

  isSubmitting.value = true;
  formError.value = null;

  try {
    const payload = {
      category: form.category as ExpenseCategory,
      amount,
      description: form.description.trim() || null,
      date: new Date(form.date).toISOString(),
    };

    if (editing.value) {
      await expenseService.update(editing.value.id, payload);
      toast.success('Expense updated.');
    } else {
      await expenseService.create({
        ...payload,
        ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      });
      toast.success('Expense recorded.');
    }

    isFormOpen.value = false;
    await expenses.reload();
  } catch (caught) {
    formError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};

const review = async (expense: Expense, decision: 'approved' | 'rejected'): Promise<void> => {
  try {
    await expenseService.review(expense.id, decision);
    toast.success(`Expense ${decision}.`);
    await expenses.reload();
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  }
};
</script>

<template>
  <div class="mx-auto flex max-w-6xl flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Expenses</h2>
        <p class="mt-1 text-sm text-ink-500">Costs recorded against the business.</p>
      </div>
      <BaseButton @click="openForm(null)">Record expense</BaseButton>
    </div>

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <BaseSelect
        v-model="category"
        label="Category"
        :options="EXPENSE_CATEGORIES.map((value) => ({ value, label: value }))"
        placeholder="All categories"
      />
      <BaseSelect
        v-model="status"
        label="Status"
        :options="EXPENSE_STATUSES.map((value) => ({ value, label: value }))"
        placeholder="All statuses"
      />
      <BaseInput v-model="from" label="From" type="date" />
      <BaseInput v-model="to" label="To" type="date" />
    </div>

    <DataTable
      :columns="columns"
      :rows="expenses.items.value"
      :loading="expenses.isLoading.value"
      :error="expenses.error.value"
      :pagination="expenses.pagination.value"
      caption="Expenses"
      empty-title="No expenses in this range"
      empty-description="Record one, or widen the dates."
      @retry="expenses.reload()"
      @page="expenses.goToPage"
    >
      <template #cell-date="{ row }">
        <span class="text-sm text-ink-700">{{ formatDate(row.date) }}</span>
      </template>

      <template #cell-category="{ row }">
        <BaseBadge>{{ row.category }}</BaseBadge>
        <p v-if="row.description" class="mt-1 text-xs text-ink-500 sm:hidden">
          {{ row.description }}
        </p>
      </template>

      <template #cell-description="{ row }">
        <span class="text-sm text-ink-700">{{ row.description ?? '—' }}</span>
      </template>

      <template #cell-amount="{ row }">
        <span class="font-medium text-ink-900">{{ formatMoney(row.amount) }}</span>
      </template>

      <template #cell-status="{ row }">
        <div class="flex items-center justify-end gap-1">
          <BaseBadge :tone="STATUS_TONES[row.status]" dot>{{ row.status }}</BaseBadge>
          <template v-if="canReviewExpenses && row.status === 'pending'">
            <BaseButton variant="ghost" size="sm" @click="review(row, 'approved')">
              Approve
            </BaseButton>
            <BaseButton variant="ghost" size="sm" @click="review(row, 'rejected')">
              Reject
            </BaseButton>
          </template>
          <BaseButton
            v-else-if="row.status === 'pending'"
            variant="ghost"
            size="sm"
            @click="openForm(row)"
          >
            Edit
          </BaseButton>
        </div>
      </template>

      <template #empty-action>
        <BaseButton size="sm" @click="openForm(null)">Record expense</BaseButton>
      </template>
    </DataTable>

    <p v-if="expenses.items.value.length > 0" class="text-right text-sm text-ink-500">
      This page totals
      <strong class="tabular-nums text-ink-900">{{ formatMoney(pageTotal) }}</strong>
      across {{ expenses.items.value.length }} of {{ expenses.pagination.value.total }} expenses.
    </p>

    <BaseModal
      v-model:open="isFormOpen"
      :title="editing ? 'Edit expense' : 'Record expense'"
      size="sm"
    >
      <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
        <BaseSelect
          v-model="form.category"
          label="Category"
          required
          :options="EXPENSE_CATEGORIES.map((value) => ({ value, label: value }))"
        />
        <BaseInput
          v-model="form.amount"
          label="Amount"
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          required
          :error="amountError"
        />
        <BaseInput v-model="form.date" label="Date" type="date" required />
        <BaseInput
          v-model="form.description"
          label="Description"
          placeholder="Optional"
          :maxlength="1000"
        />
        <p v-if="formError" class="text-sm text-danger-600" role="alert">{{ formError }}</p>
      </form>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isSubmitting" @click="isFormOpen = false">
          Cancel
        </BaseButton>
        <BaseButton :loading="isSubmitting" @click="submit">
          {{ editing ? 'Save changes' : 'Record' }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
