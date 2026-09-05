<script setup lang="ts">
import { ANALYTICS_CONFIDENT_THRESHOLD, type AnalyticsInsight } from '@hadiya/shared';

import type { AnalyticsInsightsBlock } from '@/chat/message-content';

/**
 * What changed, ranked, with the evidence still attached.
 *
 * The evidence is shown rather than hidden behind a toggle: an insight a person
 * cannot check is an insight they have to take on faith, and the whole point of
 * computing these server-side was that they should not have to.
 *
 * Findings below the confidence bar are visibly marked as possibilities. That
 * is the visual half of the same rule the assistant follows in prose — a maybe
 * must not be able to read with the same authority as a certainty.
 */
defineProps<{ report: AnalyticsInsightsBlock }>();

/**
 * Severity is shown as a word as well as a colour.
 *
 * A tinted left border alone would put the entire meaning of the card into hue,
 * which excludes anyone who cannot separate the tints — and washes out entirely
 * on a phone in sunlight.
 */
const SEVERITY_STYLES: Record<string, string> = {
  high: 'bg-danger-50 text-danger-700 ring-danger-600/20',
  medium: 'bg-warning-50 text-warning-700 ring-warning-600/20',
  low: 'bg-surface-muted text-ink-500 ring-border-subtle',
  info: 'bg-surface-muted text-ink-500 ring-border-subtle',
};

const isConfident = (insight: AnalyticsInsight): boolean =>
  insight.confidence >= ANALYTICS_CONFIDENT_THRESHOLD;
</script>

<template>
  <div class="my-2 flex flex-col gap-3">
    <div class="rounded-[14px] bg-surface p-5 shadow-sm ring-1 ring-border-subtle">
      <p class="mb-4 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400">
        {{ report.periodLabel }}
      </p>

      <ul class="flex flex-col gap-4">
        <li v-for="(insight, index) in report.insights" :key="index" class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] ring-1"
              :class="SEVERITY_STYLES[insight.severity] ?? SEVERITY_STYLES.info"
            >
              {{ insight.severity }}
            </span>

            <span aria-hidden="true" class="text-[12px] text-ink-400">
              {{ insight.direction === 'up' ? '↑' : insight.direction === 'down' ? '↓' : '→' }}
            </span>

            <p class="min-w-0 flex-1 text-[14px] font-semibold text-ink-900">
              {{ insight.headline }}
            </p>
          </div>

          <!--
            Said in words, not implied by a faded colour: a low-confidence
            finding is a possibility, and it must read as one.
          -->
          <p v-if="!isConfident(insight)" class="mt-1 text-[12px] italic text-ink-500">
            This may be the case — the evidence is limited.
          </p>

          <ul class="mt-1.5 flex flex-col gap-0.5">
            <li
              v-for="(evidence, line) in insight.evidence"
              :key="line"
              class="text-[12px] leading-relaxed text-ink-500"
            >
              {{ evidence }}
            </li>
          </ul>
        </li>
      </ul>
    </div>

    <div
      v-if="report.recommendations.length > 0"
      class="rounded-[14px] bg-surface-muted p-5 ring-1 ring-border-subtle"
    >
      <p class="mb-3 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400">
        Worth considering
      </p>

      <ul class="flex flex-col gap-3">
        <li v-for="(recommendation, index) in report.recommendations" :key="index">
          <p class="text-[13px] font-medium text-ink-900">
            {{ recommendation.recommendation }}
          </p>
          <p class="mt-0.5 text-[12px] text-ink-500">{{ recommendation.rationale }}</p>
        </li>
      </ul>

      <!--
        Stated on the card itself. Nothing here has been done, and a suggestion
        that reads like a completed action is the worst possible ambiguity in a
        tool that can also perform actions.
      -->
      <p class="mt-3 text-[11px] text-ink-400">Suggestions only — nothing has been changed.</p>
    </div>

    <p
      v-if="report.incompleteNotes.length > 0"
      class="rounded-[12px] bg-warning-50 px-4 py-3 text-[12px] text-warning-700 ring-1 ring-warning-600/20"
      role="note"
    >
      {{ report.incompleteNotes.join(' ') }}
    </p>
  </div>
</template>
