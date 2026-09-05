<script setup lang="ts">
import { formatMoney, type BusinessAlert } from '@hadiya/shared';
import { computed } from 'vue';

/**
 * One business alert, with the figures it was raised from.
 *
 * The evidence is on the card rather than behind a link because an alert
 * somebody cannot check is one they have to take on faith — and the first time
 * it is wrong, faith is what it loses. Everything shown here was computed on
 * the server; this component formats and arranges, and calculates nothing.
 *
 * Severity is carried by a word as well as a tint. A card whose entire meaning
 * is a hue is unreadable to anyone who cannot separate those hues, and washes
 * out completely on a phone held in sunlight — which is exactly where a
 * shopkeeper reads it.
 */
const props = defineProps<{ alert: BusinessAlert; compact?: boolean }>();

const emit = defineEmits<{ acknowledge: [string]; dismiss: [string] }>();

const TONE: Record<string, string> = {
  critical: 'bg-danger-50 text-danger-700 ring-danger-600/25',
  high: 'bg-danger-50 text-danger-700 ring-danger-600/20',
  medium: 'bg-warning-50 text-warning-700 ring-warning-600/20',
  low: 'bg-surface-muted text-ink-500 ring-border-subtle',
  info: 'bg-surface-muted text-ink-500 ring-border-subtle',
};

const isResolved = computed(
  () => props.alert.status === 'resolved' || props.alert.status === 'dismissed',
);

const isOpen = computed(() => !isResolved.value);

/** Money metrics are minor units; a stock count is a plain number. */
const MONEY_METRICS = new Set(['netSales', 'grossSales', 'outstandingDebt', 'revenue']);

const showValue = (value: number): string =>
  MONEY_METRICS.has(props.alert.evidence.metric)
    ? formatMoney(value)
    : new Intl.NumberFormat('uz-UZ').format(value);

const change = computed(() => {
  const percent = props.alert.evidence.changePercent;

  // `null` is a real answer, not a missing one: there was no base to compare
  // against. Saying so beats printing "∞%" or a confident "+100%".
  return percent === null
    ? null
    : { text: `${percent > 0 ? '+' : ''}${percent}%`, up: percent > 0 };
});
</script>

<template>
  <article
    class="rounded-[14px] bg-surface p-4 ring-1 ring-border-subtle"
    :class="isResolved ? 'opacity-60' : ''"
  >
    <div class="flex flex-wrap items-center gap-2">
      <span
        class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ring-1"
        :class="TONE[alert.severity] ?? TONE.info"
      >
        {{ alert.severity }}
      </span>

      <span
        v-if="isResolved"
        class="rounded-full bg-positive-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-positive-700 ring-1 ring-positive-600/20"
      >
        {{ alert.status }}
      </span>

      <span
        v-if="alert.entity.name"
        class="truncate text-[11px] font-medium text-ink-400"
        :title="alert.entity.name"
      >
        {{ alert.entity.name }}
      </span>
    </div>

    <h3 class="mt-2 text-[14px] font-semibold leading-snug text-ink-900">
      {{ alert.title }}
    </h3>

    <p class="mt-1 text-[12px] leading-relaxed text-ink-500">{{ alert.summary }}</p>

    <dl v-if="!compact" class="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2">
      <div>
        <dt class="text-[11px] text-ink-400">Now</dt>
        <dd class="text-[14px] font-semibold tabular-nums text-ink-900">
          {{ showValue(alert.evidence.currentValue) }}
        </dd>
      </div>

      <div v-if="alert.evidence.previousValue !== null">
        <dt class="text-[11px] text-ink-400">Before</dt>
        <dd class="text-[14px] font-semibold tabular-nums text-ink-500">
          {{ showValue(alert.evidence.previousValue) }}
        </dd>
      </div>

      <div v-if="change">
        <dt class="text-[11px] text-ink-400">Change</dt>
        <dd
          class="flex items-center gap-1 text-[14px] font-semibold tabular-nums"
          :class="change.up ? 'text-positive-700' : 'text-danger-600'"
        >
          <!-- An arrow as well as the tint, so direction survives without colour. -->
          <span aria-hidden="true">{{ change.up ? '↑' : '↓' }}</span>
          {{ change.text }}
        </dd>
      </div>
    </dl>

    <p class="mt-3 text-[11px] text-ink-400">
      {{ alert.evidence.periodFrom }}
      <template v-if="alert.evidence.periodTo !== alert.evidence.periodFrom">
        → {{ alert.evidence.periodTo }}
      </template>
      <template v-if="alert.occurrences > 1"> · seen {{ alert.occurrences }} times</template>
    </p>

    <!--
      Shown, never hidden. A figure that is quietly partial is the one failure a
      reader cannot detect for themselves.
    -->
    <p
      v-if="!alert.evidence.dataComplete"
      class="mt-2 rounded-[10px] bg-warning-50 px-3 py-2 text-[11px] text-warning-700"
      role="note"
    >
      These figures were incomplete when the alert was raised.
    </p>

    <div v-if="isOpen && !compact" class="mt-3 flex flex-wrap gap-2">
      <button
        type="button"
        class="rounded-full px-3 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-border-subtle hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-brand-500"
        @click="emit('acknowledge', alert.id)"
      >
        Ko‘rdim
      </button>
      <button
        type="button"
        class="rounded-full px-3 py-1 text-[12px] font-medium text-ink-500 hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
        @click="emit('dismiss', alert.id)"
      >
        Yopish
      </button>
    </div>
  </article>
</template>
