<script setup lang="ts">
import { computed } from 'vue';

/**
 * That the microphone is live, and for how long.
 *
 * A recording indicator is a trust feature before it is a UI feature: somebody
 * whose microphone is open should never have to wonder. Hence the pulsing dot,
 * the running clock, and a visible way out that is not the same button that
 * started it.
 */
const props = defineProps<{ elapsedSeconds: number; remainingSeconds: number; nearLimit: boolean }>();

const emit = defineEmits<{ stop: []; cancel: [] }>();

const clock = computed(() => {
  const minutes = Math.floor(props.elapsedSeconds / 60);
  const seconds = props.elapsedSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
});
</script>

<template>
  <div
    class="flex items-center gap-2 rounded-[20px] bg-danger-50 py-1.5 pl-3 pr-1.5 ring-1 ring-danger-600/25"
    role="status"
    aria-live="polite"
  >
    <span class="relative flex size-2 shrink-0" aria-hidden="true">
      <span class="absolute inline-flex size-full animate-ping rounded-full bg-danger-600 opacity-60" />
      <span class="relative inline-flex size-2 rounded-full bg-danger-600" />
    </span>

    <span class="text-xs font-medium tabular-nums text-danger-700">
      {{ clock }}
      <span class="sr-only">recording</span>
    </span>

    <span v-if="nearLimit" class="text-[11px] text-danger-700">
      {{ remainingSeconds }}s left
    </span>

    <button
      type="button"
      class="rounded-full px-2 py-1 text-[11px] font-medium text-danger-700 hover:bg-danger-600/10 focus:outline-none focus:ring-2 focus:ring-danger-600"
      @click="emit('cancel')"
    >
      Cancel
    </button>

    <button
      type="button"
      class="grid size-7 shrink-0 place-items-center rounded-full bg-danger-600 text-white transition-colors hover:bg-danger-700 focus:outline-none focus:ring-2 focus:ring-danger-600 focus:ring-offset-1"
      aria-label="Stop recording and transcribe"
      @click="emit('stop')"
    >
      <svg class="size-3" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <rect x="6" y="6" width="12" height="12" rx="2" />
      </svg>
    </button>
  </div>
</template>
