<script setup lang="ts">
/**
 * One figure, with what it means.
 *
 * The caption is not decoration: "collected today" and "billed today" are
 * different numbers, and a card showing only a currency amount invites the
 * reader to guess which one they are looking at.
 */
withDefaults(
  defineProps<{ label: string; value: string; caption?: string; tone?: 'default' | 'warning' }>(),
  { caption: undefined, tone: 'default' },
);
</script>

<template>
  <div class="rounded-xl bg-surface px-4 py-3.5 ring-1 ring-border-subtle">
    <p class="text-xs font-medium uppercase tracking-wide text-ink-500">{{ label }}</p>
    <p
      class="mt-1 text-xl font-semibold tabular-nums"
      :class="tone === 'warning' ? 'text-warning-700' : 'text-ink-900'"
    >
      {{ value }}
    </p>
    <p v-if="caption" class="mt-0.5 text-xs text-ink-500">{{ caption }}</p>
  </div>
</template>
