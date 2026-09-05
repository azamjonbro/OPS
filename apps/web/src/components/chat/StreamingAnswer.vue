<script setup lang="ts">
/**
 * The answer as it is being written.
 *
 * Plain text, not markdown, and that is a decision rather than a shortcut.
 * Half-written markdown is markdown that is wrong: a table with one row of
 * pipes, a bold that never closes, a list that reflows on every token. Parsing
 * it each frame would cost the most and look the worst at exactly the moment
 * somebody is watching. The finished turn is re-read from the transcript a
 * moment later and rendered properly there, so nothing is lost by waiting.
 *
 * The caret is the only ornament, and it is doing a job: it marks the live edge
 * of the text, which is how a reader can tell a pause in the model from a
 * finished answer. It holds still for anyone who has asked for less motion.
 */
defineProps<{ text: string }>();
</script>

<template>
  <div class="group/message flex w-full gap-4 pb-2">
    <span
      class="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 text-[12px] font-bold text-white shadow-sm ring-1 ring-brand-100 dark:ring-surface-raised"
      aria-hidden="true"
    >
      H
    </span>

    <div class="min-w-0 flex-1 px-2 py-1">
      <p
        class="whitespace-pre-wrap text-[15px] leading-relaxed text-ink-900"
        aria-live="polite"
        aria-atomic="false"
      >
        {{ text
        }}<span
          class="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.15em] bg-brand-500 motion-safe:animate-pulse"
          aria-hidden="true"
        />
      </p>
    </div>
  </div>
</template>
