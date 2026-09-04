<script setup lang="ts">
import { formatMoney, type Customer } from '@hadiya/shared';
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { customerService } from '@/services/customer.service';

const router = useRouter();
const toast = useToast();

const search = useDebouncedRef('', 300);
const debtFilter = ref('');

const customers = usePaginatedResource<Customer>(
  (params, signal) =>
    customerService.list(
      {
        ...params,
        ...(search.value ? { search: search.value } : {}),
        ...(debtFilter.value === 'debt' ? { withDebt: true } : {}),
      },
      { signal },
    ),
  { watchSources: [() => search.value, () => debtFilter.value] },
);

const columns: TableColumn[] = [
  { key: 'fullName', label: 'Customer' },
  { key: 'phone', label: 'Phone', hideOnMobile: true },
  { key: 'debt', label: 'Owes', align: 'right' },
  { key: 'status', label: 'Status', align: 'right' },
];

const isFormOpen = ref(false);
const isSubmitting = ref(false);
const formError = ref<string | null>(null);
const form = reactive({ fullName: '', phone: '', notes: '' });
const errors = reactive<{ fullName: string | null; phone: string | null }>({
  fullName: null,
  phone: null,
});

const openCreate = (): void => {
  form.fullName = '';
  form.phone = '';
  form.notes = '';
  errors.fullName = null;
  errors.phone = null;
  formError.value = null;
  isFormOpen.value = true;
};

const submit = async (): Promise<void> => {
  if (isSubmitting.value) {
    return;
  }

  errors.fullName = form.fullName.trim().length < 2 ? 'At least 2 characters' : null;
  errors.phone = /^\+?[0-9\s-]{7,20}$/.test(form.phone.trim()) ? null : 'Enter a valid phone number';

  if (errors.fullName || errors.phone) {
    return;
  }

  isSubmitting.value = true;
  formError.value = null;

  try {
    await customerService.create({
      fullName: form.fullName.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim() || null,
    });

    toast.success('Customer added.');
    isFormOpen.value = false;
    await customers.reload();
  } catch (caught) {
    formError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Customers</h2>
        <p class="mt-1 text-sm text-ink-500">Who buys, and who still owes.</p>
      </div>
      <BaseButton @click="openCreate">New customer</BaseButton>
    </div>

    <div class="grid gap-3 sm:grid-cols-2">
      <BaseInput
        v-model="search"
        label="Search"
        type="search"
        placeholder="Name or phone"
        autocomplete="off"
      />
      <BaseSelect
        v-model="debtFilter"
        label="Filter"
        :options="[{ value: 'debt', label: 'Only customers with debt' }]"
        placeholder="All customers"
      />
    </div>

    <DataTable
      :columns="columns"
      :rows="customers.items.value"
      :loading="customers.isLoading.value"
      :error="customers.error.value"
      :pagination="customers.pagination.value"
      selectable
      caption="Customers"
      empty-title="No customers match"
      empty-description="Add a customer to record sales on account."
      @retry="customers.reload()"
      @page="customers.goToPage"
      @select="(customer) => router.push({ name: 'customer-detail', params: { id: customer.id } })"
    >
      <template #cell-fullName="{ row }">
        <p class="font-medium text-ink-900">{{ row.fullName }}</p>
        <p class="text-xs text-ink-500 sm:hidden">{{ row.phone }}</p>
      </template>

      <template #cell-phone="{ row }">
        <span class="text-sm text-ink-700">{{ row.phone }}</span>
      </template>

      <template #cell-debt="{ row }">
        <span
          class="font-medium tabular-nums"
          :class="row.debtBalance > 0 ? 'text-warning-700' : 'text-ink-500'"
        >
          {{ row.debtBalance > 0 ? formatMoney(row.debtBalance) : '—' }}
        </span>
      </template>

      <template #cell-status="{ row }">
        <BaseBadge :tone="row.status === 'active' ? 'positive' : 'neutral'" dot>
          {{ row.status }}
        </BaseBadge>
      </template>

      <template #empty-action>
        <BaseButton size="sm" @click="openCreate">New customer</BaseButton>
      </template>
    </DataTable>

    <BaseModal v-model:open="isFormOpen" title="New customer" size="sm">
      <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
        <BaseInput v-model="form.fullName" label="Full name" required :error="errors.fullName" :maxlength="160" />
        <BaseInput
          v-model="form.phone"
          label="Phone"
          type="tel"
          required
          :error="errors.phone"
          placeholder="+998 90 123 45 67"
        />
        <BaseInput v-model="form.notes" label="Notes" placeholder="Optional" :maxlength="2000" />
        <p v-if="formError" class="text-sm text-danger-600" role="alert">{{ formError }}</p>
      </form>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isSubmitting" @click="isFormOpen = false">
          Cancel
        </BaseButton>
        <BaseButton :loading="isSubmitting" @click="submit">Add customer</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
