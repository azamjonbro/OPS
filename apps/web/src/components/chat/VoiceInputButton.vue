<script setup lang="ts">
import { computed } from 'vue';

import type { VoiceInputPhase } from '@/composables/useVoiceInput';

/**
 * The microphone.
 *
 * One control with a label that says what pressing it will do next, rather than
 * an icon that leaves the person guessing. It is a real `button`, so it is in
 * the tab order and works from the keyboard with no extra handling, and it
 * keeps its visible focus ring.
 *
 * Disabled while a transcription is in flight: starting a second recording on
 * top of one being transcribed is not a thing anybody means to do.
 */
const props = defineProps<{ phase: VoiceInputPhase; supported: boolean }>();

const emit = defineEmits<{ activate: [] }>();

const isBusy = computed(() => props.phase === 'uploading' || props.phase === 'transcribing');

const label = computed(() => {
  if (!props.supported) {
    return 'Voice input is not available in this browser';
  }

  if (props.phase === 'recording') {
    return 'Stop recording and transcribe';
  }

  if (isBusy.value) {
    return 'Transcribing your recording';
  }

  return 'Start voice input';
});
</script>

<template>
  <button
    type="button"
    class="mb-1.5 grid size-[34px] shrink-0 place-items-center rounded-[12px] text-ink-500 transition-all duration-200 hover:bg-border-subtle/60 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40"
    :class="phase === 'recording' ? 'bg-danger-50 text-danger-600 hover:bg-danger-50' : ''"
    :disabled="!supported || isBusy"
    :aria-label="label"
    :title="label"
    :aria-pressed="phase === 'recording'"
    @click="emit('activate')"
  >
    <svg
      v-if="isBusy"
      class="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
    <svg
      v-else
      class="size-[18px]"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
    </svg>
  </button>
</template>
