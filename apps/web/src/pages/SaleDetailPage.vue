<script setup lang="ts">
import { formatMoney, type Sale } from '@hadiya/shared';
import { onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseCard from '@/components/ui/BaseCard.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import { usePermissions } from '@/composables/usePermissions';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { saleService } from '@/services/sales.service';
import { formatDateTime } from '@/utils/format';

/**
 * One receipt.
 *
 * Cancelling is a server operation that returns stock and reverses payments, so
 * the page asks for a reason and shows whatever the API says came back — it does
 * not attempt to describe the consequences itself.
 */
const route = useRoute();
const toast = useToast();
const { canManageCatalogue } = usePermissions();

const sale = ref<Sale | null>(null);
const isLoading = ref(false);
const error = ref<string | null>(null);

const isCancelOpen = ref(false);
const reason = ref('');
const isCancelling = ref(false);
const cancelError = ref<string | null>(null);

const load = async (): Promise<void> => {
  const id = String(route.params.id ?? '');

  if (!id) {
    return;
  }

  isLoading.value = true;
  error.value = null;

  try {
    sale.value = await saleService.get(id);
  } catch (caught) {
    error.value = toErrorMessage(caught);
    sale.value = null;
  } finally {
    isLoading.value = false;
  }
};

const cancel = async (): Promise<void> => {
  if (isCancelling.value || !sale.value) {
    return;
  }

  if (reason.value.trim().length < 3) {
    cancelError.value = 'Give a reason of at least 3 characters.';

    return;
  }

  isCancelling.value = true;
  cancelError.value = null;

  try {
    sale.value = await saleService.cancel(sale.value.id, reason.value.trim());
    isCancelOpen.value = false;
    reason.value = '';
    toast.success('Sale cancelled and stock returned.');
  } catch (caught) {
    cancelError.value = toErrorMessage(caught);
  } finally {
    isCancelling.value = false;
  }
};

onMounted(load);
watch(() => route.params.id, load);
</script>

<template>
  <div class="mx-auto flex max-w-3xl flex-col gap-5">
    <RouterLink :to="{ name: 'sales' }" class="text-sm text-ink-500 hover:text-ink-900">
      ← All sales
    </RouterLink>

    <LoadingSkeleton v-if="isLoading" variant="card" :rows="2" />
    <ErrorState v-else-if="error" :message="error" @retry="load" />

    <template v-else-if="sale">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold text-ink-900">{{ sale.number }}</h2>
          <p class="mt-1 text-sm text-ink-500">{{ formatDateTime(sale.soldAt) }}</p>
        </div>
        <div class="flex items-center gap-2">
          <BaseBadge :tone="sale.status === 'cancelled' ? 'danger' : 'positive'" dot>
            {{ sale.status }}
          </BaseBadge>
          <BaseButton
            v-if="canManageCatalogue && sale.status !== 'cancelled'"
            variant="secondary"
            size="sm"
            @click="isCancelOpen = true"
          >
            Cancel sale
          </BaseButton>
        </div>
      </div>

      <BaseCard title="Items">
        <ul class="divide-y divide-border-subtle">
          <li v-for="line in sale.items" :key="line.sku" class="flex justify-between gap-4 py-2.5">
            <div class="min-w-0">
              <p class="truncate text-sm font-medium text-ink-900">{{ line.name }}</p>
              <p class="text-xs text-ink-500">
                {{ line.sku }} · {{ formatMoney(line.unitPrice) }} × {{ line.quantity }}
                <span v-if="line.discount > 0">· −{{ formatMoney(line.discount) }}</span>
              </p>
            </div>
            <p class="shrink-0 text-sm font-medium tabular-nums text-ink-900">
              {{ formatMoney(line.lineTotal) }}
            </p>
          </li>
        </ul>

        <dl class="mt-4 space-y-1.5 border-t border-border-subtle pt-4 text-sm">
          <div class="flex justify-between">
            <dt class="text-ink-500">Subtotal</dt>
            <dd class="tabular-nums text-ink-700">{{ formatMoney(sale.totals.subtotal) }}</dd>
          </div>
          <div v-if="sale.totals.discountTotal > 0" class="flex justify-between">
            <dt class="text-ink-500">Discount</dt>
            <dd class="tabular-nums text-ink-700">−{{ formatMoney(sale.totals.discountTotal) }}</dd>
          </div>
          <div class="flex justify-between font-semibold">
            <dt class="text-ink-900">Total</dt>
            <dd class="tabular-nums text-ink-900">{{ formatMoney(sale.totals.grandTotal) }}</dd>
          </div>
          <div class="flex justify-between">
            <dt class="text-ink-500">Paid</dt>
            <dd class="tabular-nums text-ink-700">{{ formatMoney(sale.totals.paidAmount) }}</dd>
          </div>
          <div v-if="sale.totals.dueAmount > 0" class="flex justify-between">
            <dt class="text-ink-500">Owed</dt>
            <dd class="font-medium tabular-nums text-warning-700">
              {{ formatMoney(sale.totals.dueAmount) }}
            </dd>
          </div>
        </dl>
      </BaseCard>

      <BaseCard v-if="sale.note" title="Note">
        <p class="text-sm text-ink-700">{{ sale.note }}</p>
      </BaseCard>
    </template>

    <BaseModal v-model:open="isCancelOpen" title="Cancel sale" size="sm">
      <div class="flex flex-col gap-3">
        <p class="text-sm text-ink-700">
          The server returns the stock and reverses the payments. This cannot be undone.
        </p>
        <BaseInput v-model="reason" label="Reason" required :error="cancelError" :maxlength="500" />
      </div>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isCancelling" @click="isCancelOpen = false">
          Keep sale
        </BaseButton>
        <BaseButton variant="danger" :loading="isCancelling" @click="cancel">Cancel sale</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
