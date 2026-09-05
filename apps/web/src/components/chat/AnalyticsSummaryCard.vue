<script setup lang="ts">
import { formatMoney } from '@hadiya/shared';
import { computed } from 'vue';

import type { AnalyticsSummaryBlock } from '@/chat/message-content';

/**
 * A period's figures, with how they moved.
 *
 * Every number shown here was computed on the server: this component formats
 * and arranges, and calculates nothing. A percentage worked out in the browser
 * would be a second implementation of the same arithmetic, and the two would
 * disagree the first time either changed.
 *
 * Direction is never carried by colour alone — each delta has an arrow and a
 * sign as well — because a red number and a green number are the same number
 * to a good proportion of the people reading it.
 */
const props = defineProps<{ summary: AnalyticsSummaryBlock }>();

const format = (value: number, money: boolean): string =>
  money ? formatMoney(value) : new Intl.NumberFormat('uz-UZ').format(value);

const changeFor = (label: string) =>
  props.summary.changes.find((change) => change.label.toLowerCase() === label.toLowerCase());

/**
 * The daily series as a sparkline path.
 *
 * Drawn inline rather than with a chart library: it is a shape, not a chart —
 * no axes, no ticks, nothing to read a value off — and pulling in a charting
 * dependency to draw eleven line segments would be the definition of chart
 * spam. It is hidden from assistive technology because the figures above it
 * already say everything it shows.
 */
const sparkline = computed(() => {
  const points = props.summary.daily;

  if (points.length < 3) {
    // Two points is a line segment, not a trend. Nothing worth drawing.
    return null;
  }

  const values = points.map((point) => point.revenue);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      // Inverted: SVG's y grows downward, and a rising line should rise.
      const y = 24 - ((point.revenue - min) / span) * 22;

      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
});
</script>

<template>
  <div class="my-2 flex flex-col gap-3">
    <div class="rounded-[14px] bg-surface p-5 shadow-sm ring-1 ring-border-subtle">
      <div class="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <p class="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400">
          {{ summary.periodLabel }}
        </p>
        <p v-if="summary.comparisonLabel" class="text-[11px] text-ink-400">
          vs {{ summary.comparisonLabel }}
        </p>
      </div>

      <dl class="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
        <div v-for="figure in summary.figures" :key="figure.label" class="min-w-0">
          <dt class="text-[13px] font-medium text-ink-500">{{ figure.label }}</dt>
          <dd class="mt-1 truncate text-[18px] font-bold tabular-nums tracking-tight text-ink-900">
            {{ format(figure.value, figure.money) }}
          </dd>

          <p
            v-if="changeFor(figure.label)"
            class="mt-1 flex items-center gap-1 text-[12px] font-semibold tabular-nums"
            :class="{
              'text-positive-700': changeFor(figure.label)?.direction === 'up',
              'text-danger-600': changeFor(figure.label)?.direction === 'down',
              'text-ink-400': changeFor(figure.label)?.direction === 'flat',
            }"
          >
            <span aria-hidden="true">
              {{
                changeFor(figure.label)?.direction === 'up'
                  ? '↑'
                  : changeFor(figure.label)?.direction === 'down'
                    ? '↓'
                    : '→'
              }}
            </span>
            <!--
              A null percentage is a real answer, not a missing one: the previous
              period was zero, so there is nothing to express a change against.
              Saying so beats printing "∞%" or a confident "+100%".
            -->
            <span v-if="changeFor(figure.label)?.percentageChange === null">
              no comparable figure
            </span>
            <span v-else>
              {{ (changeFor(figure.label)?.percentageChange ?? 0) > 0 ? '+' : ''
              }}{{ changeFor(figure.label)?.percentageChange }}%
            </span>
          </p>
        </div>
      </dl>

      <svg
        v-if="sparkline"
        class="mt-5 h-8 w-full text-brand-500"
        viewBox="0 0 100 26"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <path
          :d="sparkline"
          fill="none"
          stroke="currentColor"
          stroke-width="1.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          vector-effect="non-scaling-stroke"
        />
      </svg>
    </div>

    <!--
      Never collapsed behind a toggle. A figure that is quietly partial is the
      one analytics failure a reader cannot detect for themselves.
    -->
    <p
      v-if="summary.incompleteNotes.length > 0"
      class="rounded-[12px] bg-warning-50 px-4 py-3 text-[12px] text-warning-700 ring-1 ring-warning-600/20"
      role="note"
    >
      {{ summary.incompleteNotes.join(' ') }}
    </p>
  </div>
</template>
