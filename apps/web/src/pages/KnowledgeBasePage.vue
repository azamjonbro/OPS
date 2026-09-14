<script setup lang="ts">
import {
  DOCUMENT_ACCEPT_ATTRIBUTE,
  FILE_CATEGORIES,
  FILE_CATEGORY_DESCRIPTIONS,
  FILE_CATEGORY_LABELS,
  FILE_LIMITS,
  FILE_TITLE_MAX_LENGTH,
  type BusinessFile,
  type FileCategory,
} from '@hadiya/shared';
import { computed, reactive, ref } from 'vue';

import BaseBadge from '@/components/ui/BaseBadge.vue';
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
import { fileService } from '@/services/file.service';

/**
 * The knowledge base: what the assistant is told about in every conversation.
 *
 * A file attached to a chat message answers one question and is forgotten
 * with the thread. A document placed here is different in exactly one way — it
 * has a category — and that one field is what makes the assistant name it in
 * its instructions on every turn, so "chegirma qoidasi nima edi?" is answered
 * from the rules the person uploaded a month ago rather than from memory.
 *
 * The title is asked for on purpose. A filename is what the file was called on
 * somebody's disk; a title is what the person wants the assistant to know it
 * as, and it is the title the model reads.
 */
const toast = useToast();

const categoryOptions = FILE_CATEGORIES.map((category) => ({
  value: category,
  label: FILE_CATEGORY_LABELS[category],
}));

// --- Adding a document -------------------------------------------------------

const form = reactive({
  title: '',
  category: 'knowledge' as FileCategory,
});
const picked = ref<File | null>(null);
const filePicker = ref<HTMLInputElement | null>(null);
const isUploading = ref(false);
const formError = ref<string | null>(null);

const onFilePicked = (event: Event): void => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] ?? null;

  picked.value = file;
  formError.value = null;

  // The filename is a sensible first draft of the title, minus its extension;
  // the person can overwrite it, and usually should.
  if (file && form.title.trim() === '') {
    form.title = file.name.replace(/\.[^.]+$/, '');
  }
};

const submit = async (): Promise<void> => {
  formError.value = null;

  const file = picked.value;

  if (!file) {
    formError.value = 'Avval faylni tanlang.';

    return;
  }

  // Checked here as well as on the server so an obviously oversized file
  // fails in front of the person instead of after a long upload.
  if (file.size > FILE_LIMITS.maxBytes) {
    formError.value = 'Fayl hajmi ruxsat etilgan limitdan katta.';

    return;
  }

  isUploading.value = true;

  try {
    const uploaded = await fileService.upload(file, {
      title: form.title.trim() || undefined,
      category: form.category,
    });

    toast.success(`“${uploaded.displayName}” bilimlar bazasiga qo‘shildi.`);
    form.title = '';
    picked.value = null;

    if (filePicker.value) {
      filePicker.value.value = '';
    }

    await reload();
  } catch (caught) {
    // The server's sentence is shown as-is: it is already written for a
    // person and says which rule the file broke.
    formError.value = toErrorMessage(caught, 'Faylni yuklab bo‘lmadi.');
  } finally {
    isUploading.value = false;
  }
};

// --- The shelf ---------------------------------------------------------------

const filterCategory = ref<FileCategory | ''>('');

const { items, pagination, isLoading, error, reload, goToPage } =
  usePaginatedResource<BusinessFile>(
    ({ page, pageSize }, signal) =>
      fileService.list(
        {
          page,
          pageSize,
          // Without a category filter, everything that *has* a category — and
          // never the chat attachments, which live with their conversations.
          ...(filterCategory.value ? { category: filterCategory.value } : { knowledgeBase: true }),
        },
        signal,
      ),
    { watchSources: [() => filterCategory.value] },
  );

/** Bytes are the server's unit; a person reads kB and MB. */
const size = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} B`
    : bytes < 1024 * 1024
      ? `${Math.round(bytes / 1024)} kB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

const shape = (file: BusinessFile): string => {
  const sheets = file.summary?.sheets ?? [];

  if (sheets.length > 0) {
    return sheets.map((sheet) => `${sheet.name}: ${sheet.rowCount} qator`).join(', ');
  }

  if (file.summary?.pageCount) {
    return `${file.summary.pageCount} sahifa`;
  }

  return '';
};

const statusTone = (file: BusinessFile): 'positive' | 'warning' | 'danger' =>
  file.status === 'ready' ? 'positive' : file.status === 'failed' ? 'danger' : 'warning';

const statusLabel = (file: BusinessFile): string =>
  file.status === 'ready' ? 'Tayyor' : file.status === 'failed' ? 'O‘qib bo‘lmadi' : 'Ishlanmoqda';

// --- Removal -----------------------------------------------------------------

const pendingRemoval = ref<BusinessFile | null>(null);
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
    await fileService.remove(target.id);
    toast.success(`“${target.displayName}” o‘chirildi.`);
    pendingRemoval.value = null;
    await reload();
  } catch (caught) {
    toast.error(toErrorMessage(caught));
  } finally {
    isRemoving.value = false;
  }
};
</script>

<template>
  <div class="mx-auto flex max-w-5xl flex-col gap-6">
    <div>
      <h2 class="text-xl font-semibold text-ink-900">Bilimlar bazasi</h2>
      <p class="mt-1 text-sm text-ink-500">
        Bu yerdagi hujjatlarni yordamchi har bir suhbatda biladi — chatga biriktirilgan fayl esa
        faqat o‘sha suhbatda. Qoidalar, rejalar va ma’lumotnomalarni shu yerga qo‘ying.
      </p>
    </div>

    <BaseCard
      title="Hujjat qo‘shish"
      description="Sarlavha — yordamchi hujjatni shu nom bilan biladi; tur — u qaysi javonda turadi"
    >
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <div class="grid gap-4 sm:grid-cols-2">
          <BaseInput
            v-model="form.title"
            label="Sarlavha"
            placeholder="Chegirma siyosati 2026"
            :maxlength="FILE_TITLE_MAX_LENGTH"
          />

          <BaseSelect
            v-model="form.category"
            label="Turi"
            :options="categoryOptions"
            :hint="FILE_CATEGORY_DESCRIPTIONS[form.category]"
            required
          />
        </div>

        <div class="flex flex-col gap-1">
          <label for="knowledge-file" class="text-xs font-medium text-ink-700">Fayl</label>
          <input
            id="knowledge-file"
            ref="filePicker"
            type="file"
            class="block w-full text-sm text-ink-700 file:mr-3 file:rounded-lg file:border-0 file:bg-surface-muted file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink-900"
            :accept="DOCUMENT_ACCEPT_ATTRIBUTE"
            data-testid="knowledge-file"
            @change="onFilePicked"
          />
          <p v-if="formError" class="text-xs text-rose-700" role="alert">{{ formError }}</p>
          <p v-else-if="picked" class="text-xs text-ink-500">
            {{ picked.name }} · {{ size(picked.size) }}
          </p>
        </div>

        <div>
          <BaseButton type="submit" :loading="isUploading">Bazaga qo‘shish</BaseButton>
        </div>
      </form>
    </BaseCard>

    <BaseCard title="Hujjatlar" description="Oxirgisi yuqorida">
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
        title="Bazada hali hujjat yo‘q"
        description="Yuqoridagi shakl orqali birinchisini qo‘shing — yordamchi uni keyingi suhbatdanoq biladi."
      />

      <ul v-else class="flex flex-col divide-y divide-border-subtle" data-testid="knowledge-list">
        <li
          v-for="file in items"
          :key="file.id"
          class="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0"
        >
          <div class="flex min-w-0 flex-col gap-1">
            <span class="text-sm font-medium text-ink-900">{{ file.displayName }}</span>
            <span class="flex flex-wrap items-center gap-2 text-xs text-ink-500">
              <BaseBadge v-if="file.category" tone="brand">
                {{ FILE_CATEGORY_LABELS[file.category] }}
              </BaseBadge>
              <BaseBadge :tone="statusTone(file)" dot>{{ statusLabel(file) }}</BaseBadge>
              <span>{{ file.kind.toUpperCase() }} · {{ size(file.sizeBytes) }}</span>
              <span v-if="shape(file)">· {{ shape(file) }}</span>
            </span>
            <span v-if="file.failureReason" class="text-xs text-rose-700">
              {{ file.failureReason }}
            </span>
          </div>

          <BaseButton
            variant="ghost"
            size="sm"
            :aria-label="`${file.displayName} ni o‘chirish`"
            @click="pendingRemoval = file"
          >
            O‘chirish
          </BaseButton>
        </li>
      </ul>

      <p v-if="isLoading" class="mt-3 text-sm text-ink-500">Yuklanmoqda…</p>

      <BasePagination :pagination="pagination" :disabled="isLoading" @change="goToPage" />
    </BaseCard>

    <ConfirmDialog
      v-model:open="confirmOpen"
      title="Hujjatni o‘chirish"
      :message="
        pendingRemoval
          ? `“${pendingRemoval.displayName}” bazadan olib tashlanadi; yordamchi uni boshqa bilmaydi.`
          : ''
      "
      confirm-label="O‘chirish"
      cancel-label="Bekor qilish"
      :busy="isRemoving"
      @confirm="remove"
    />
  </div>
</template>
