<script setup lang="ts">
import { computed } from 'vue';

import type { Attachment } from '@/composables/useFileUpload';

/**
 * One attached document, before it is part of a message.
 *
 * States are shown in words as well as in colour, and the failure carries the
 * server's own sentence — a chip that just turns red tells somebody their file
 * did not work but not what to do about it, and the difference between "too
 * large" and "wrong type" is the whole of the next action.
 */
const props = defineProps<{ attachment: Attachment }>();

const emit = defineEmits<{ remove: [string] }>();

const ICONS: Record<string, string> = {
  xlsx: '📊',
  csv: '📊',
  pdf: '📄',
  docx: '📝',
  txt: '📝',
  md: '📝',
};

const icon = computed(() => ICONS[props.attachment.file?.kind ?? ''] ?? '📎');

/** Bytes are the server's unit; a person reads kB and MB. */
const size = computed(() => {
  const bytes = props.attachment.sizeBytes;

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} kB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
});

/** Shape rather than content: rows and sheets, never a cell. */
const shape = computed(() => {
  const summary = props.attachment.file?.summary;

  if (!summary) {
    return null;
  }

  const sheet = summary.sheets[0];

  if (sheet) {
    return `${sheet.rowCount} satr · ${sheet.columns.length} ustun`;
  }

  return summary.pageCount ? `${summary.pageCount} sahifa` : null;
});
</script>

<template>
  <div
    class="flex max-w-full items-center gap-2 rounded-[12px] bg-surface px-3 py-2 ring-1"
    :class="attachment.state === 'failed' ? 'ring-danger-600/30' : 'ring-border-subtle'"
  >
    <span class="text-[16px]" aria-hidden="true">{{ icon }}</span>

    <div class="min-w-0 flex-1">
      <p class="truncate text-[12px] font-medium text-ink-900" :title="attachment.name">
        {{ attachment.name }}
      </p>

      <p class="flex items-center gap-1.5 text-[11px] text-ink-500">
        <span>{{ size }}</span>

        <template v-if="attachment.state === 'uploading'">
          <span aria-hidden="true">·</span>
          <span class="flex items-center gap-1">
            <svg class="size-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle
                class="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                stroke-width="4"
              />
              <path
                class="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z"
              />
            </svg>
            O‘qilmoqda…
          </span>
        </template>

        <template v-else-if="attachment.state === 'ready'">
          <span aria-hidden="true">·</span>
          <!-- A tick and a word: readiness is not carried by colour alone. -->
          <span class="text-positive-700">✓ Tayyor</span>
          <template v-if="shape">
            <span aria-hidden="true">·</span>
            <span>{{ shape }}</span>
          </template>
        </template>
      </p>

      <p v-if="attachment.error" class="mt-0.5 text-[11px] text-danger-600" role="alert">
        {{ attachment.error }}
      </p>
    </div>

    <button
      type="button"
      class="grid size-6 shrink-0 touch-manipulation place-items-center rounded-full text-ink-400 hover:bg-surface-muted hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
      :aria-label="`Remove ${attachment.name}`"
      @click="emit('remove', attachment.localId)"
    >
      <svg
        class="size-3.5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.2"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>
  </div>
</template>
