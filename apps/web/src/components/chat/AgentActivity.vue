<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import type { ActivityStep } from '@/chat/agent-run';

/**
 * What Hadiya is doing, while it does it.
 *
 * Drawn as a **ledger** rather than a list of spinners, because that is the
 * shape of the thing being reported: a shop runs on records of what was done,
 * what it cost, and what did not happen. A rail runs down the left and is drawn
 * only as far as the work has actually got — it stops where the run stopped.
 *
 * Two rules the whole component exists to keep:
 *
 *  - **Nothing is invented.** Every row here came from an event the server
 *    emitted. There is no optimistic step, no predicted next step, and no
 *    progress bar guessing at a percentage. A timeline that invented one row
 *    would make every other row unbelievable.
 *  - **Parallel work looks parallel.** Steps that ran at the same time share a
 *    bracket on the rail instead of being stacked as though one waited for the
 *    other. Implying an order the backend did not have would be a lie about how
 *    the shop's own figures were gathered.
 *
 * When the run finishes, this collapses to a single line. During the work it is
 * the most important thing on screen; afterwards the answer is, and a finished
 * ledger should step back rather than compete with it.
 *
 * State is never carried by colour alone: each row has its own mark — an arc, a
 * tick, a cross, a dash — so it reads the same to somebody who cannot tell the
 * brand colour from the danger one.
 */
const props = withDefaults(
  defineProps<{
    steps: ActivityStep[];
    /** True while the run is going. Drives the live region and the collapse. */
    active?: boolean;
    /** True while a dropped connection is being rejoined. */
    reconnecting?: boolean;
  }>(),
  { active: false, reconnecting: false },
);

/** Open while the work is happening; closed once it is history. */
const isOpen = ref(true);
/** Set once the person has decided for themselves, and then respected. */
const wasToggled = ref(false);

watch(
  () => props.active,
  (active) => {
    if (!wasToggled.value) {
      isOpen.value = active;
    }
  },
);

const toggle = (): void => {
  wasToggled.value = true;
  isOpen.value = !isOpen.value;
};

const running = computed(() => props.steps.filter((step) => step.status === 'running'));
const failed = computed(() =>
  props.steps.filter((step) => step.status === 'failed' || step.status === 'skipped'),
);
/**
 * The one line the collapsed ledger shows.
 *
 * Counts rather than adjectives: "4 steps, 1 didn't work" is checkable, and
 * "mostly successful" is not.
 */
const summary = computed(() => {
  const total = props.steps.length;

  if (props.active) {
    const first = running.value[0];

    return first ? first.runningLabel : 'Working';
  }

  if (failed.value.length > 0) {
    return `${String(total)} steps · ${String(failed.value.length)} didn't work`;
  }

  return total === 1 ? '1 step' : `${String(total)} steps`;
});

/**
 * Whether this row and the one below it ran at the same time.
 *
 * Read from the wave the reducer assigned, which is derived from the events
 * themselves — a step that started while another was still running. Nothing
 * here guesses: without that evidence, no bracket is drawn.
 */
const sharesWaveWithNext = (index: number): boolean => {
  const step = props.steps[index];
  const next = props.steps[index + 1];

  return Boolean(step && next && step.wave === next.wave);
};

/**
 * What a row says.
 *
 * A step that failed is never given the past tense of the thing it did not do:
 * "Saved to Notion" under a cross would be the interface contradicting itself,
 * and it is exactly the sentence a person would go on to repeat to somebody
 * else. A failed row is named by what it *was* — "Notion" — and the reason sits
 * underneath it in the server's own words.
 */
const label = (step: ActivityStep): string => {
  if (step.status === 'running') {
    return step.runningLabel;
  }

  return step.status === 'completed' ? step.doneLabel : step.displayName;
};

const MARKS: Record<ActivityStep['status'], string> = {
  // A tick, a cross, a dash. Shape carries the state; colour only reinforces it.
  completed: 'M4 8.5 6.8 11.4 12 5.6',
  failed: 'M4.8 4.8l6.4 6.4M11.2 4.8l-6.4 6.4',
  skipped: 'M4 8h8',
  running: '',
};
</script>

<template>
  <div
    v-if="steps.length > 0 || active"
    class="my-1.5 w-full max-w-[34rem] text-[13px]"
    role="group"
    aria-label="What Hadiya is doing"
  >
    <button
      type="button"
      class="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-ink-500 transition-colors hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
      :aria-expanded="isOpen"
      @click="toggle"
    >
      <span class="grid size-4 shrink-0 place-items-center" aria-hidden="true">
        <svg
          v-if="active"
          class="size-3.5 text-brand-600 motion-safe:animate-spin dark:text-brand-400"
          viewBox="0 0 16 16"
          fill="none"
        >
          <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="2" opacity="0.25" />
          <path d="M8 2a6 6 0 0 1 6 6" stroke="currentColor" stroke-width="2" />
        </svg>
        <svg
          v-else
          class="size-3 transition-transform duration-200"
          :class="isOpen ? 'rotate-90' : ''"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="m6 3 5 5-5 5" />
        </svg>
      </span>

      <span class="min-w-0 truncate" :class="active ? 'text-brand-700 dark:text-brand-300' : ''">
        {{ summary }}<span v-if="active">…</span>
      </span>

      <span
        v-if="reconnecting"
        class="shrink-0 rounded-full bg-warning-50 px-2 py-0.5 text-[11px] text-warning-700"
      >
        Reconnecting
      </span>
    </button>

    <!-- The live region is the collapsed summary, not the whole ledger: a
         screen reader should hear "Read the sales figures", not every row
         again each time one of them changes. -->
    <p class="sr-only" aria-live="polite" aria-atomic="true">
      {{ active ? `Hadiya is working: ${summary}` : `Finished: ${summary}` }}
    </p>

    <ol v-if="isOpen && steps.length > 0" class="mt-1 space-y-0.5 pl-[0.4375rem]">
      <li
        v-for="(step, index) in steps"
        :key="step.callId"
        class="relative flex items-start gap-2.5 py-1 pl-4"
      >
        <!-- The rail. Drawn between rows rather than around them, and only
             where work actually continued. -->
        <span
          class="absolute left-0 top-0 w-px bg-border-subtle"
          :class="index === steps.length - 1 ? 'h-3' : 'h-full'"
          aria-hidden="true"
        />
        <span
          v-if="sharesWaveWithNext(index)"
          class="absolute -left-px top-3 h-[calc(100%-0.25rem)] w-[3px] rounded-full bg-brand-500/25"
          aria-hidden="true"
          title="ran at the same time"
        />

        <span
          class="absolute left-0 top-[0.5625rem] grid size-[13px] -translate-x-1/2 place-items-center rounded-full ring-2 ring-surface"
          :class="{
            'bg-brand-500': step.status === 'running',
            'bg-positive-600': step.status === 'completed',
            'bg-danger-600': step.status === 'failed',
            'bg-ink-400': step.status === 'skipped',
          }"
          aria-hidden="true"
        >
          <svg
            v-if="step.status === 'running'"
            class="size-2.5 text-white motion-safe:animate-spin"
            viewBox="0 0 16 16"
            fill="none"
          >
            <path d="M8 1.5a6.5 6.5 0 0 1 6.5 6.5" stroke="currentColor" stroke-width="3" />
          </svg>
          <svg
            v-else
            class="size-[11px] text-white"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path :d="MARKS[step.status]" />
          </svg>
        </span>

        <span class="min-w-0 flex-1">
          <span
            class="block"
            :class="{
              'text-brand-700 dark:text-brand-300': step.status === 'running',
              'text-ink-600': step.status === 'completed',
              'text-danger-700': step.status === 'failed',
              'text-ink-400': step.status === 'skipped',
            }"
          >
            {{ label(step) }}
            <span v-if="step.status === 'running'" aria-hidden="true">…</span>
          </span>

          <span v-if="step.message" class="mt-0.5 block text-[12px] text-ink-500">
            {{ step.message }}
          </span>

          <span
            v-if="step.attempts > 1 && step.status !== 'failed'"
            class="mt-0.5 block text-[11px] text-ink-400"
          >
            Took {{ step.attempts }} attempts
          </span>
        </span>

        <span
          v-if="step.integration"
          class="shrink-0 pt-px text-[11px] text-ink-400"
          :title="`from ${step.integration}`"
        >
          {{ step.integration }}
        </span>
      </li>
    </ol>
  </div>
</template>
