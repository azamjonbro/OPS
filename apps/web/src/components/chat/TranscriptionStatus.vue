<script setup lang="ts">
import type { VoiceInputPhase } from '@/composables/useVoiceInput';

/**
 * What is happening between "stop" and words appearing.
 *
 * Three states rather than one spinner, because they take noticeably different
 * amounts of time and a person who can see which one they are in is far more
 * willing to wait for it. Announced politely so the wait is legible to a screen
 * reader too.
 *
 * Cancelling is offered here as well as while recording. Transcription is the
 * longest wait in the feature, and somebody who has changed their mind should
 * not have to sit through it — the request is abandoned and its answer, if it
 * ever arrives, is discarded rather than dropped into the composer.
 */
defineProps<{ phase: VoiceInputPhase }>();

const emit = defineEmits<{ cancel: [] }>();

const LABELS: Partial<Record<VoiceInputPhase, string>> = {
  requesting: 'Waiting for microphone permission…',
  uploading: 'Uploading…',
  transcribing: 'Transcribing…',
};
</script>

<template>
  <p
    v-if="LABELS[phase]"
    class="flex items-center gap-2 text-xs font-medium text-ink-500"
    role="status"
    aria-live="polite"
  >
    <svg
      class="size-3.5 animate-spin text-brand-500"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
    {{ LABELS[phase] }}
    <button
      type="button"
      class="rounded px-1 py-0.5 font-medium underline hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
      @click="emit('cancel')"
    >
      Cancel
    </button>
  </p>
</template>
