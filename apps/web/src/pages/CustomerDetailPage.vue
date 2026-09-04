<script setup lang="ts">
import { formatMoney, type Customer, type Sale } from '@hadiya/shared';
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { customerService } from '@/services/customer.service';
import { paymentService, saleService } from '@/services/sales.service';
import { formatDateTime } from '@/utils/format';

/**
 * One customer: who they are, what they bought, and what they owe.
 *
 * The debt balance is read, never written: it is maintained by the sale and
 * payment services, so the only way to change it here is to record a payment
 * and let the server recompute.
 */
const route = useRoute();
const toast = useToast();

const customer = ref<Customer | null>(null);
const sales = ref<Sale[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

const isPaymentOpen = ref(false);
const isSubmitting = ref(false);
const paymentError = ref<string | null>(null);
const payment = reactive({ amount: '', method: 'cash' });

const load = async (): Promise<void> => {
  const id = String(route.params.id ?? '');

  if (!id) {
    return;
  }

  isLoading.value = true;
  error.value = null;

  try {
    const [record, history] = await Promise.all([
      customerService.get(id),
      saleService.list({ customerId: id, pageSize: 20 }),
    ]);

    customer.value = record;
    sales.value = history.items;
  } catch (caught) {
    error.value = toErrorMessage(caught);
    customer.value = null;
  } finally {
    isLoading.value = false;
  }
};

const recordPayment = async (): Promise<void> => {
  if (isSubmitting.value || !customer.value) {
    return;
  }

  const amount = Math.round(Number.parseFloat(payment.amount || '0') * 100);

  if (!Number.isFinite(amount) || amount <= 0) {
    paymentError.value = 'Enter an amount greater than zero.';

    return;
  }

  isSubmitting.value = true;
  paymentError.value = null;

  try {
    await paymentService.record({
      customerId: customer.value.id,
      amount,
      method: payment.method as 'cash' | 'card' | 'transfer',
    });

    toast.success('Payment recorded.');
    isPaymentOpen.value = false;
    payment.amount = '';
    await load();
  } catch (caught) {
    paymentError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};

onMounted(load);
watch(() => route.params.id, load);
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5">
    <RouterLink :to="{ name: 'customers' }" class="text-sm text-ink-500 hover:text-ink-900">
      ← All customers
    </RouterLink>

    <LoadingSkeleton v-if="isLoading" variant="card" :rows="2" />
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else-if="customer">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-ink-900">{{ customer.fullName }}</h2>
          <p class="mt-1 text-sm text-ink-500">{{ customer.phone }}</p>
        </div>
        <BaseBadge :tone="customer.status === 'active' ? 'positive' : 'neutral'" dot>
          {{ customer.status }}
        </BaseBadge>
      </div>

      <BaseCard title="Balance" description="Maintained by the sale and payment services">
        <template #header>
          <BaseButton
            v-if="customer.debtBalance > 0"
            size="sm"
            variant="secondary"
            @click="isPaymentOpen = true"
          >
            Record payment
          </BaseButton>
        </template>

        <p
          class="text-2xl font-semibold tabular-nums"
          :class="customer.debtBalance > 0 ? 'text-warning-700' : 'text-positive-700'"
        >
          {{ customer.debtBalance > 0 ? formatMoney(customer.debtBalance) : 'Nothing owed' }}
        </p>
      </BaseCard>

      <BaseCard v-if="customer.notes" title="Notes">
        <p class="text-sm text-ink-700">{{ customer.notes }}</p>
      </BaseCard>

      <BaseCard title="Purchase history" :description="`${sales.length} recent sale(s)`">
        <EmptyState
          v-if="sales.length === 0"
          title="No purchases yet"
          description="Sales rung up against this customer will appear here."
        />
        <ul v-else class="divide-y divide-border-subtle">
          <li v-for="sale in sales" :key="sale.id" class="flex justify-between gap-4 py-2.5">
            <div class="min-w-0">
              <RouterLink
                :to="{ name: 'sale-detail', params: { id: sale.id } }"
                class="text-sm font-medium text-ink-900 hover:text-brand-700"
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
    </template>

    <BaseModal v-model:open="isPaymentOpen" title="Record payment" size="sm">
      <div class="flex flex-col gap-4">
        <p class="text-sm text-ink-700">
          Owed: <strong class="tabular-nums">{{ formatMoney(customer?.debtBalance ?? 0) }}</strong>
        </p>
        <BaseInput
          v-model="payment.amount"
          label="Amount"
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          required
        />
        <BaseSelect
          v-model="payment.method"
          label="Method"
          :options="[
            { value: 'cash', label: 'cash' },
            { value: 'card', label: 'card' },
            { value: 'transfer', label: 'transfer' },
          ]"
        />
        <p v-if="paymentError" class="text-sm text-danger-600" role="alert">{{ paymentError }}</p>
      </div>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isSubmitting" @click="isPaymentOpen = false">
          Cancel
        </BaseButton>
        <BaseButton :loading="isSubmitting" @click="recordPayment">Record payment</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
