<script setup lang="ts">
import {
  formatMoney,
  PAYMENT_METHODS,
  type Customer,
  type PaymentMethod,
  type Sale,
} from '@hadiya/shared';
import { computed, ref } from 'vue';

import ProductSearchPanel from '@/components/pos/ProductSearchPanel.vue';
import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useCart } from '@/composables/useCart';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { customerService } from '@/services/customer.service';
import { saleService } from '@/services/sales.service';
import { useBranchesStore } from '@/stores/branches';

/**
 * The till.
 *
 * Two things matter more than anything else on this screen.
 *
 * The first is that the totals shown while ringing up are a preview: the server
 * reads prices from the product and recomputes the sale, and the receipt that
 * comes back is what is displayed as the result. A client that decided the price
 * would be a client that could be tampered with.
 *
 * The second is that a sale is submitted exactly once. `isSubmitting` guards the
 * handler as well as disabling the button, because on a slow connection a
 * cashier will press again — and a duplicated sale means duplicated stock
 * movements and a customer charged twice, which is not something an "undo"
 * makes right.
 */
const toast = useToast();
const branches = useBranchesStore();
const cart = useCart();

const customer = ref<Customer | null>(null);
const note = ref('');
const isSubmitting = ref(false);
const completedSale = ref<Sale | null>(null);
const submitError = ref<string | null>(null);

const isPaymentOpen = ref(false);
const paymentMethod = ref<PaymentMethod>('cash');
const tendered = ref('');

const isCustomerOpen = ref(false);
const customerSearch = useDebouncedRef('', 300);
const customerResults = ref<Customer[]>([]);
const isSearchingCustomers = ref(false);

const paymentOptions = PAYMENT_METHODS.map((method) => ({ value: method, label: method }));

/** Blank means "paid in full"; a typed amount is a part payment on account. */
const tenderedMinor = computed(() =>
  tendered.value.trim() === ''
    ? cart.grandTotal.value
    : Math.max(0, Math.round(Number.parseFloat(tendered.value || '0') * 100)),
);

const changeDue = computed(() => Math.max(0, tenderedMinor.value - cart.grandTotal.value));
const stillOwed = computed(() => Math.max(0, cart.grandTotal.value - tenderedMinor.value));

const searchCustomers = async (): Promise<void> => {
  const term = customerSearch.value.trim();

  if (term.length === 0) {
    customerResults.value = [];

    return;
  }

  isSearchingCustomers.value = true;

  try {
    const result = await customerService.list({ search: term, pageSize: 10, status: 'active' });
    customerResults.value = result.items;
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isSearchingCustomers.value = false;
  }
};

const openPayment = (): void => {
  submitError.value = null;
  tendered.value = '';
  paymentMethod.value = 'cash';
  isPaymentOpen.value = true;
};

const completeSale = async (): Promise<void> => {
  if (isSubmitting.value || cart.isEmpty.value) {
    return;
  }

  isSubmitting.value = true;
  submitError.value = null;

  try {
    // A payment of zero is not an event worth recording, and the API refuses
    // it; an unpaid sale is simply one with no payments attached.
    const paidNow = Math.min(tenderedMinor.value, cart.grandTotal.value);

    const sale = await saleService.create({
      items: cart.toPayload(),
      ...(customer.value ? { customerId: customer.value.id } : {}),
      ...(branches.scopeBranchId ? { branchId: branches.scopeBranchId } : {}),
      ...(note.value.trim() ? { note: note.value.trim() } : {}),
      ...(paidNow > 0 ? { payments: [{ amount: paidNow, method: paymentMethod.value }] } : {}),
    });

    completedSale.value = sale;
    isPaymentOpen.value = false;
    cart.clear();
    customer.value = null;
    note.value = '';
    toast.success(`Sale ${sale.number} completed.`);
  } catch (caught) {
    // The basket is deliberately left intact: the cashier can correct whatever
    // the server objected to and try again without re-scanning everything.
    submitError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};

const startNextSale = (): void => {
  completedSale.value = null;
};
</script>

<template>
  <div class="mx-auto h-full max-w-7xl">
    <!-- The receipt state replaces the till until the cashier moves on. -->
    <div v-if="completedSale" class="mx-auto max-w-lg">
      <div class="rounded-xl bg-surface p-6 text-center ring-1 ring-border-subtle">
        <span
          class="mx-auto grid size-12 place-items-center rounded-full bg-positive-50 text-positive-700"
          aria-hidden="true"
        >
          <svg
            class="size-6"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="m20 6-11 11-5-5" />
          </svg>
        </span>
        <h2 class="mt-3 text-lg font-semibold text-ink-900">Sale {{ completedSale.number }}</h2>
        <p class="mt-1 text-sm text-ink-500">Recorded by the server; stock has been adjusted.</p>

        <dl class="mt-5 space-y-2 text-left">
          <div class="flex justify-between text-sm">
            <dt class="text-ink-500">Total</dt>
            <dd class="font-medium tabular-nums text-ink-900">
              {{ formatMoney(completedSale.totals.grandTotal) }}
            </dd>
          </div>
          <div class="flex justify-between text-sm">
            <dt class="text-ink-500">Paid</dt>
            <dd class="tabular-nums text-ink-900">
              {{ formatMoney(completedSale.totals.paidAmount) }}
            </dd>
          </div>
          <div v-if="completedSale.totals.dueAmount > 0" class="flex justify-between text-sm">
            <dt class="text-ink-500">Owed</dt>
            <dd class="font-medium tabular-nums text-warning-700">
              {{ formatMoney(completedSale.totals.dueAmount) }}
            </dd>
          </div>
        </dl>

        <ul class="mt-4 divide-y divide-border-subtle border-y border-border-subtle text-left">
          <li
            v-for="line in completedSale.items"
            :key="line.sku"
            class="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span class="min-w-0 truncate text-ink-700">{{ line.name }} ×{{ line.quantity }}</span>
            <span class="shrink-0 tabular-nums text-ink-900">{{
              formatMoney(line.lineTotal)
            }}</span>
          </li>
        </ul>

        <div class="mt-5 flex justify-center gap-2">
          <BaseButton @click="startNextSale">New sale</BaseButton>
          <RouterLink :to="{ name: 'sale-detail', params: { id: completedSale.id } }">
            <BaseButton variant="secondary">View receipt</BaseButton>
          </RouterLink>
        </div>
      </div>
    </div>

    <div v-else class="grid h-full gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section
        class="flex min-h-0 flex-col rounded-xl bg-surface-muted p-4 ring-1 ring-border-subtle"
        aria-label="Find products"
      >
        <ProductSearchPanel @select="cart.add" />
      </section>

      <section
        class="flex min-h-0 flex-col rounded-xl bg-surface ring-1 ring-border-subtle"
        aria-label="Current sale"
      >
        <header
          class="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3"
        >
          <h2 class="text-sm font-semibold text-ink-900">
            Current sale
            <span v-if="!cart.isEmpty.value" class="font-normal text-ink-500">
              · {{ cart.itemCount.value }} item(s)
            </span>
          </h2>
          <BaseButton v-if="!cart.isEmpty.value" variant="ghost" size="sm" @click="cart.clear()">
            Clear
          </BaseButton>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto">
          <EmptyState
            v-if="cart.isEmpty.value"
            title="Nothing in the sale yet"
            description="Scan a barcode or search for a product to start."
            icon="M3 3h2l3 12h10l3-8H7M9 21h.01M18 21h.01"
          />

          <ul v-else class="divide-y divide-border-subtle">
            <li v-for="line in cart.lines.value" :key="line.product.id" class="px-4 py-3">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-ink-900">{{ line.product.name }}</p>
                  <p class="text-xs text-ink-500">
                    {{ formatMoney(line.product.price) }} · {{ line.product.sku }}
                  </p>
                </div>
                <button
                  type="button"
                  class="shrink-0 rounded p-1 text-ink-500 hover:bg-surface-muted hover:text-danger-600"
                  :aria-label="`Remove ${line.product.name}`"
                  @click="cart.remove(line.product.id)"
                >
                  <svg
                    class="size-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div class="mt-2 flex items-center justify-between gap-3">
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    class="grid size-8 place-items-center rounded-lg ring-1 ring-border-subtle hover:bg-surface-muted"
                    :aria-label="`Decrease ${line.product.name}`"
                    @click="cart.setQuantity(line.product.id, line.quantity - 1)"
                  >
                    −
                  </button>
                  <label class="sr-only" :for="`qty-${line.product.id}`">
                    Quantity for {{ line.product.name }}
                  </label>
                  <input
                    :id="`qty-${line.product.id}`"
                    :value="line.quantity"
                    type="number"
                    min="0"
                    step="0.001"
                    inputmode="decimal"
                    class="h-8 w-16 rounded-lg bg-surface px-2 text-center text-sm tabular-nums text-ink-900 ring-1 ring-inset ring-border-subtle focus:outline-none focus:ring-2 focus:ring-brand-600"
                    @change="
                      cart.setQuantity(
                        line.product.id,
                        Number(($event.target as HTMLInputElement).value),
                      )
                    "
                  />
                  <button
                    type="button"
                    class="grid size-8 place-items-center rounded-lg ring-1 ring-border-subtle hover:bg-surface-muted"
                    :aria-label="`Increase ${line.product.name}`"
                    @click="cart.setQuantity(line.product.id, line.quantity + 1)"
                  >
                    +
                  </button>
                </div>

                <p class="text-sm font-semibold tabular-nums text-ink-900">
                  {{ formatMoney(line.product.price * line.quantity - line.discount) }}
                </p>
              </div>
            </li>
          </ul>
        </div>

        <footer class="border-t border-border-subtle px-4 py-3">
          <button
            type="button"
            class="mb-3 flex w-full items-center justify-between rounded-lg bg-surface-muted px-3 py-2 text-left text-sm hover:bg-border-subtle/40"
            @click="isCustomerOpen = true"
          >
            <span class="text-ink-500">Customer</span>
            <span class="font-medium text-ink-900">
              {{ customer ? customer.fullName : 'Walk-in' }}
            </span>
          </button>

          <dl class="space-y-1.5 text-sm">
            <div class="flex justify-between">
              <dt class="text-ink-500">Subtotal</dt>
              <dd class="tabular-nums text-ink-700">{{ formatMoney(cart.subtotal.value) }}</dd>
            </div>
            <div v-if="cart.discountTotal.value > 0" class="flex justify-between">
              <dt class="text-ink-500">Discount</dt>
              <dd class="tabular-nums text-ink-700">
                −{{ formatMoney(cart.discountTotal.value) }}
              </dd>
            </div>
            <div class="flex justify-between border-t border-border-subtle pt-1.5">
              <dt class="font-semibold text-ink-900">Total</dt>
              <dd class="text-lg font-semibold tabular-nums text-ink-900">
                {{ formatMoney(cart.grandTotal.value) }}
              </dd>
            </div>
          </dl>

          <p class="mt-1 text-[0.6875rem] text-ink-400">
            A preview — the server recalculates and returns the receipt.
          </p>

          <BaseButton class="mt-3" block :disabled="cart.isEmpty.value" @click="openPayment">
            Take payment
          </BaseButton>
        </footer>
      </section>
    </div>

    <BaseModal v-model:open="isPaymentOpen" title="Take payment" size="sm">
      <div class="flex flex-col gap-4">
        <div class="rounded-lg bg-surface-muted px-4 py-3 text-center">
          <p class="text-xs uppercase tracking-wide text-ink-500">Total due</p>
          <p class="text-2xl font-semibold tabular-nums text-ink-900">
            {{ formatMoney(cart.grandTotal.value) }}
          </p>
        </div>

        <BaseSelect v-model="paymentMethod" label="Method" :options="paymentOptions" />

        <BaseInput
          v-model="tendered"
          label="Amount received"
          type="number"
          inputmode="decimal"
          step="0.01"
          min="0"
          placeholder="Leave blank for the full amount"
          :hint="
            stillOwed > 0
              ? `${formatMoney(stillOwed)} will be recorded as owed`
              : changeDue > 0
                ? `Change: ${formatMoney(changeDue)}`
                : 'Paid in full'
          "
        />

        <BaseInput v-model="note" label="Note" placeholder="Optional" :maxlength="1000" />

        <p v-if="stillOwed > 0 && !customer" class="text-xs text-warning-700">
          A part payment without a customer cannot be collected later. Choose a customer first if
          this is on account.
        </p>

        <p v-if="submitError" class="text-sm text-danger-600" role="alert">{{ submitError }}</p>
      </div>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isSubmitting" @click="isPaymentOpen = false">
          Back
        </BaseButton>
        <BaseButton :loading="isSubmitting" :disabled="isSubmitting" @click="completeSale">
          Complete sale
        </BaseButton>
      </template>
    </BaseModal>

    <BaseModal v-model:open="isCustomerOpen" title="Choose a customer" size="sm">
      <div class="flex flex-col gap-3">
        <BaseInput
          v-model="customerSearch"
          label="Search"
          type="search"
          placeholder="Name or phone"
          autocomplete="off"
          @update:model-value="searchCustomers"
        />

        <BaseButton
          variant="secondary"
          size="sm"
          @click="((customer = null), (isCustomerOpen = false))"
        >
          Walk-in (no customer)
        </BaseButton>

        <p v-if="isSearchingCustomers" class="text-sm text-ink-500">Searching…</p>

        <ul v-else-if="customerResults.length > 0" class="divide-y divide-border-subtle">
          <li v-for="result in customerResults" :key="result.id">
            <button
              type="button"
              class="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-surface-muted"
              @click="((customer = result), (isCustomerOpen = false))"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-ink-900">
                  {{ result.fullName }}
                </span>
                <span class="block text-xs text-ink-500">{{ result.phone }}</span>
              </span>
              <BaseBadge v-if="result.debtBalance > 0" tone="warning">
                {{ formatMoney(result.debtBalance) }} owed
              </BaseBadge>
            </button>
          </li>
        </ul>

        <p v-else-if="customerSearch.trim()" class="text-sm text-ink-500">No customer matches.</p>
      </div>
    </BaseModal>
  </div>
</template>
