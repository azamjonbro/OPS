<script setup lang="ts">
import { useToasts } from '@/composables/useToast';

/**
 * Where toasts are rendered. Mounted once, in the application shell.
 *
 * The region is `aria-live` so a screen reader announces a message that appears
 * without focus moving to it — a success confirmation is useless if only sighted
 * users learn the save worked. Errors are `assertive`; everything else is polite.
 */
const { toasts, dismiss } = useToasts();

const TONE_CLASSES = {
  success: 'bg-positive-50 text-positive-700 ring-positive-600/30',
  error: 'bg-danger-50 text-danger-700 ring-danger-600/30',
  info: 'bg-surface text-ink-900 ring-border-subtle',
} as const;
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-0 sm:top-0 sm:items-end"
  >
    <div
      v-for="toast in toasts"
      :key="toast.id"
      class="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl px-4 py-3 shadow-lg ring-1"
      :class="TONE_CLASSES[toast.tone]"
      :role="toast.tone === 'error' ? 'alert' : 'status'"
      :aria-live="toast.tone === 'error' ? 'assertive' : 'polite'"
    >
      <p class="min-w-0 flex-1 text-sm">{{ toast.message }}</p>
      <button
        type="button"
        class="shrink-0 rounded p-0.5 opacity-70 hover:opacity-100"
        aria-label="Dismiss notification"
        @click="dismiss(toast.id)"
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
  </div>
</template>
