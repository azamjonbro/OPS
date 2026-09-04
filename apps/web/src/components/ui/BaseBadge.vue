<script setup lang="ts">
import { computed } from 'vue';

type Tone = 'neutral' | 'brand' | 'positive' | 'warning' | 'danger';

/**
 * A status chip.
 *
 * Tones are named for meaning rather than colour, so a status maps to a tone
 * once and every screen agrees on what "overdue" looks like.
 */
const props = withDefaults(defineProps<{ tone?: Tone; dot?: boolean }>(), {
  tone: 'neutral',
  dot: false,
});

const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-700 ring-border-subtle',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
  positive: 'bg-positive-50 text-positive-700 ring-positive-600/30',
  warning: 'bg-warning-50 text-warning-700 ring-warning-600/30',
  danger: 'bg-danger-50 text-danger-700 ring-danger-600/30',
};

const DOT_CLASSES: Record<Tone, string> = {
  neutral: 'bg-ink-400',
  brand: 'bg-brand-600',
  positive: 'bg-positive-600',
  warning: 'bg-warning-600',
  danger: 'bg-danger-600',
};

const classes = computed(() => TONE_CLASSES[props.tone]);
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
    :class="classes"
  >
    <span v-if="dot" class="size-1.5 rounded-full" :class="DOT_CLASSES[tone]" aria-hidden="true" />
    <slot />
  </span>
</template>
