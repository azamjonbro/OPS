<script setup lang="ts">
import type { Category } from '@hadiya/shared';
import { reactive, ref } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';
import BaseButton from '@/components/ui/BaseButton.vue';
import BaseInput from '@/components/ui/BaseInput.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import DataTable, { type TableColumn } from '@/components/ui/DataTable.vue';
import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { usePaginatedResource } from '@/composables/usePaginatedResource';
import { usePermissions } from '@/composables/usePermissions';
import { useToast } from '@/composables/useToast';
import { toErrorMessage } from '@/services/api-error';
import { categoryService } from '@/services/catalogue.service';

const { canManageCatalogue } = usePermissions();
const toast = useToast();

const search = useDebouncedRef('', 300);

const categories = usePaginatedResource<Category>(
  (params, signal) =>
    categoryService.list(
      { ...params, ...(search.value ? { search: search.value } : {}) },
      { signal },
    ),
  { watchSources: [() => search.value] },
);

const isFormOpen = ref(false);
const editing = ref<Category | null>(null);
const removing = ref<Category | null>(null);
const isSubmitting = ref(false);
const isRemoving = ref(false);
const formError = ref<string | null>(null);

const form = reactive({ name: '', description: '' });
const nameError = ref<string | null>(null);

const columns: TableColumn[] = [
  { key: 'name', label: 'Category' },
  { key: 'status', label: 'Status', align: 'right' },
  { key: 'actions', label: '', align: 'right', width: '1%' },
];

const openForm = (category: Category | null): void => {
  editing.value = category;
  form.name = category?.name ?? '';
  form.description = category?.description ?? '';
  nameError.value = null;
  formError.value = null;
  isFormOpen.value = true;
};

const submit = async (): Promise<void> => {
  if (isSubmitting.value) {
    return;
  }

  nameError.value = form.name.trim().length < 2 ? 'At least 2 characters' : null;

  if (nameError.value) {
    return;
  }

  isSubmitting.value = true;
  formError.value = null;

  try {
    const payload = { name: form.name.trim(), description: form.description.trim() || null };

    if (editing.value) {
      await categoryService.update(editing.value.id, payload);
      toast.success('Category updated.');
    } else {
      await categoryService.create(payload);
      toast.success('Category created.');
    }

    isFormOpen.value = false;
    await categories.reload();
  } catch (caught) {
    formError.value = toErrorMessage(caught);
  } finally {
    isSubmitting.value = false;
  }
};

const confirmRemove = async (): Promise<void> => {
  const category = removing.value;

  if (!category || isRemoving.value) {
    return;
  }

  isRemoving.value = true;

  try {
    await categoryService.remove(category.id);
    toast.success(`${category.name} removed.`);
    removing.value = null;
    await categories.reload();
  } catch (caught) {
    // The API refuses to remove a category that still has products; that
    // message is the useful one, so it is shown as-is.
    toast.error(toErrorMessage(caught));
  } finally {
    isRemoving.value = false;
  }
};
</script>

<template>
  <div class="mx-auto flex max-w-4xl flex-col gap-5">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 class="text-xl font-semibold text-ink-900">Categories</h2>
        <p class="mt-1 text-sm text-ink-500">How the catalogue is organised.</p>
      </div>
      <BaseButton v-if="canManageCatalogue" @click="openForm(null)">New category</BaseButton>
    </div>

    <BaseInput
      v-model="search"
      label="Search"
      type="search"
      placeholder="Category name"
      autocomplete="off"
    />

    <DataTable
      :columns="columns"
      :rows="categories.items.value"
      :loading="categories.isLoading.value"
      :error="categories.error.value"
      :pagination="categories.pagination.value"
      caption="Categories"
      empty-title="No categories yet"
      empty-description="Products need a category before they can be created."
      @retry="categories.reload()"
      @page="categories.goToPage"
    >
      <template #cell-name="{ row }">
        <p class="font-medium text-ink-900">{{ row.name }}</p>
        <p v-if="row.description" class="text-xs text-ink-500">{{ row.description }}</p>
      </template>

      <template #cell-status="{ row }">
        <BaseBadge :tone="row.isActive ? 'positive' : 'neutral'" dot>
          {{ row.isActive ? 'Active' : 'Inactive' }}
        </BaseBadge>
      </template>

      <template #cell-actions="{ row }">
        <div v-if="canManageCatalogue" class="flex justify-end gap-1">
          <BaseButton variant="ghost" size="sm" @click="openForm(row)">Edit</BaseButton>
          <BaseButton variant="ghost" size="sm" @click="removing = row">Delete</BaseButton>
        </div>
      </template>

      <template #empty-action>
        <BaseButton v-if="canManageCatalogue" size="sm" @click="openForm(null)">
          New category
        </BaseButton>
      </template>
    </DataTable>

    <BaseModal
      v-model:open="isFormOpen"
      :title="editing ? 'Edit category' : 'New category'"
      size="sm"
    >
      <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
        <BaseInput v-model="form.name" label="Name" required :error="nameError" :maxlength="120" />
        <BaseInput
          v-model="form.description"
          label="Description"
          placeholder="Optional"
          :maxlength="500"
        />
        <p v-if="formError" class="text-sm text-danger-600" role="alert">{{ formError }}</p>
      </form>

      <template #footer>
        <BaseButton variant="ghost" :disabled="isSubmitting" @click="isFormOpen = false">
          Cancel
        </BaseButton>
        <BaseButton :loading="isSubmitting" @click="submit">
          {{ editing ? 'Save changes' : 'Create' }}
        </BaseButton>
      </template>
    </BaseModal>

    <ConfirmDialog
      :open="removing !== null"
      title="Delete category"
      :message="`Delete ${removing?.name ?? ''}? Categories that still hold products cannot be removed.`"
      confirm-label="Delete"
      :busy="isRemoving"
      @update:open="(value) => !value && (removing = null)"
      @confirm="confirmRemove"
      @cancel="removing = null"
    />
  </div>
</template>
