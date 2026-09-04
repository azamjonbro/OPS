<script setup lang="ts">
import { PRODUCT_UNITS, type Category, type Product, type ProductUnit } from '@hadiya/shared';
import { computed, reactive, ref, watch } from 'vue';

import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSelect from '@/components/ui/BaseSelect.vue';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { productService } from '@/services/catalogue.service';

/**
 * Creating and editing a product.
 *
 * One form for both, because they differ in exactly two ways: the SKU is fixed
 * once assigned, and an existing product can be deactivated. Splitting them
 * would duplicate the validation and let the two drift apart.
 *
 * Prices are entered as decimals and stored as minor units. The conversion
 * happens here, once, on submit — every layer below this holds an integer, so
 * nothing downstream can accumulate a rounding error.
 */
const open = defineModel<boolean>('open', { required: true });

const props = defineProps<{ product: Product | null; categories: Category[] }>();

const emit = defineEmits<{ saved: [product: Product] }>();

const toast = useToast();
const isSubmitting = ref(false);
const formError = ref<string | null>(null);

const form = reactive({
  name: '',
  sku: '',
  barcode: '',
  description: '',
  categoryId: '',
  price: '',
  costPrice: '',
  unit: 'piece' as ProductUnit,
  trackInventory: true,
  reorderLevel: '0',
});

const errors = reactive<Record<string, string | null>>({
  name: null,
  sku: null,
  categoryId: null,
  price: null,
});

const isEditing = computed(() => props.product !== null);

const categoryOptions = computed(() =>
  props.categories.map((category) => ({ value: category.id, label: category.name })),
);

const unitOptions = PRODUCT_UNITS.map((unit) => ({ value: unit, label: unit }));

/** Minor units from a typed decimal; `12.50` becomes `1250`. */
const toMinor = (value: string): number => Math.round(Number.parseFloat(value || '0') * 100);

const reset = (): void => {
  const product = props.product;

  form.name = product?.name ?? '';
  form.sku = product?.sku ?? '';
  form.barcode = product?.barcode ?? '';
  form.description = product?.description ?? '';
  form.categoryId = product?.category ?? props.categories[0]?.id ?? '';
  form.price = product ? (product.price / 100).toFixed(2) : '';
  form.costPrice = product ? (product.costPrice / 100).toFixed(2) : '';
  form.unit = product?.unit ?? 'piece';
  form.trackInventory = product?.trackInventory ?? true;
  form.reorderLevel = String(product?.reorderLevel ?? 0);

  for (const key of Object.keys(errors)) {
    errors[key] = null;
  }

  formError.value = null;
};

watch(open, (isOpen) => isOpen && reset(), { immediate: true });

/** Mirrors the API's own rules, so a mistake is caught before a round trip. */
const validate = (): boolean => {
  errors.name = form.name.trim().length < 2 ? 'At least 2 characters' : null;
  errors.sku =
    !isEditing.value && !/^[A-Za-z0-9._-]{2,64}$/.test(form.sku.trim())
      ? 'Letters, digits, dot, underscore and hyphen only'
      : null;
  errors.categoryId = form.categoryId ? null : 'Choose a category';
  errors.price =
    form.price.trim() === '' || Number.isNaN(Number(form.price)) || Number(form.price) < 0
      ? 'Enter a price'
      : null;

  return Object.values(errors).every((error) => error === null);
};

const submit = async (): Promise<void> => {
  // Guarding on the flag as well as disabling the button: a double Enter press
  // can queue two submits before the first render disables anything.
  if (isSubmitting.value || !validate()) {
    return;
  }

  isSubmitting.value = true;
  formError.value = null;

  try {
    const shared = {
      name: form.name.trim(),
      barcode: form.barcode.trim() || null,
      description: form.description.trim() || null,
      categoryId: form.categoryId,
      price: toMinor(form.price),
      costPrice: toMinor(form.costPrice),
      unit: form.unit,
      trackInventory: form.trackInventory,
      reorderLevel: Number.parseInt(form.reorderLevel || '0', 10),
    };

    const saved = props.product
      ? await productService.update(props.product.id, shared)
      : await productService.create({ ...shared, sku: form.sku.trim().toUpperCase() });

    toast.success(isEditing.value ? 'Product updated.' : 'Product created.');
    emit('saved', saved);
    open.value = false;
  } catch (caught) {
    formError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};
</script>

<template>
  <BaseModal
    v-model:open="open"
    :title="isEditing ? 'Edit product' : 'New product'"
    :description="isEditing ? product?.sku : 'Prices are entered in whole currency units.'"
  >
    <form class="grid gap-4 sm:grid-cols-2" novalidate @submit.prevent="submit">
      <div class="sm:col-span-2">
        <BaseInput v-model="form.name" label="Name" required :error="errors.name" :maxlength="200" />
      </div>

      <BaseInput
        v-model="form.sku"
        label="SKU"
        required
        :disabled="isEditing"
        :error="errors.sku"
        :hint="isEditing ? 'A SKU cannot be changed once assigned' : undefined"
      />
      <BaseInput v-model="form.barcode" label="Barcode" placeholder="Optional" />

      <BaseSelect
        v-model="form.categoryId"
        label="Category"
        required
        :options="categoryOptions"
        placeholder="Choose a category"
        :error="errors.categoryId"
      />
      <BaseSelect v-model="form.unit" label="Unit" :options="unitOptions" />

      <BaseInput
        v-model="form.price"
        label="Selling price"
        type="number"
        inputmode="decimal"
        step="0.01"
        min="0"
        required
        :error="errors.price"
      />
      <BaseInput
        v-model="form.costPrice"
        label="Cost price"
        type="number"
        inputmode="decimal"
        step="0.01"
        min="0"
        hint="Used for margin reporting"
      />

      <BaseInput
        v-model="form.reorderLevel"
        label="Reorder level"
        type="number"
        inputmode="numeric"
        min="0"
      />

      <label class="flex items-center gap-2 self-end pb-2 text-sm text-ink-700">
        <input
          v-model="form.trackInventory"
          type="checkbox"
          class="size-4 rounded border-border-strong text-brand-600 focus:ring-brand-600"
        />
        Track inventory
      </label>

      <div class="sm:col-span-2">
        <BaseInput v-model="form.description" label="Description" placeholder="Optional" :maxlength="2000" />
      </div>

      <p v-if="formError" class="text-sm text-danger-600 sm:col-span-2" role="alert">
        {{ formError }}
      </p>
    </form>

    <template #footer>
      <BaseButton variant="ghost" :disabled="isSubmitting" @click="open = false">Cancel</BaseButton>
      <BaseButton :loading="isSubmitting" @click="submit">
        {{ isEditing ? 'Save changes' : 'Create product' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
