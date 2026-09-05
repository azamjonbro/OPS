<script setup lang="ts">
/**
 * The assistant is working on an answer.
 *
 * It says "thinking" and nothing more specific, because the API answers once at
 * the end and the client genuinely does not know whether a tool is running.
 * Naming a step here would be a guess dressed as a status. The real steps
 * appear as tool cards a moment later, from the transcript, where they happened.
 *
 * `role="status"` so a screen reader is told the assistant is busy without the
 * announcement stealing focus.
 */
withDefaults(defineProps<{ label?: string }>(), { label: 'Hadiya is thinking' });
</script>

<template>
  <div class="flex items-center gap-2.5 text-sm text-ink-500" role="status" aria-live="polite">
    <span class="flex items-center gap-1" aria-hidden="true">
      <span class="dot size-1.5 rounded-full bg-ink-400" />
      <span class="dot size-1.5 rounded-full bg-ink-400" style="animation-delay: 0.15s" />
      <span class="dot size-1.5 rounded-full bg-ink-400" style="animation-delay: 0.3s" />
    </span>
    {{ label }}…
  </div>
</template>

<style scoped>
.dot {
  animation: pulse 1.1s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

/* Somebody who asked for less motion gets a static row of dots. */
@media (prefers-reduced-motion: reduce) {
  .dot {
    animation: none;
    opacity: 0.6;
  }
}
</style>
