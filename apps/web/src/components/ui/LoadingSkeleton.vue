<script setup lang="ts">
/**
 * A placeholder shaped like the content that is coming.
 *
 * Preferred over a spinner for lists and tables: it keeps the layout from
 * jumping when data lands, and it tells the person how much is on its way.
 * `aria-hidden` with a live-region label means a screen reader hears "loading"
 * once instead of a dozen empty boxes.
 */
withDefaults(defineProps<{ rows?: number; variant?: 'text' | 'row' | 'card' }>(), {
  rows: 3,
  variant: 'text',
});
</script>

<template>
  <div role="status" aria-live="polite" class="w-full">
    <span class="sr-only">Loading…</span>
    <div class="flex animate-pulse flex-col gap-3" aria-hidden="true">
      <template v-if="variant === 'card'">
        <div v-for="row in rows" :key="row" class="h-24 rounded-xl bg-surface-muted" />
      </template>
      <template v-else-if="variant === 'row'">
        <div
          v-for="row in rows"
          :key="row"
          class="flex items-center gap-4 rounded-lg bg-surface-muted px-4 py-3"
        >
          <div class="h-3 w-1/4 rounded bg-border-subtle" />
          <div class="h-3 w-1/3 rounded bg-border-subtle" />
          <div class="ml-auto h-3 w-16 rounded bg-border-subtle" />
        </div>
      </template>
      <template v-else>
        <div
          v-for="row in rows"
          :key="row"
          class="h-3 rounded bg-surface-muted"
          :style="{ width: `${100 - row * 8}%` }"
        />
      </template>
    </div>
  </div>
</template>
