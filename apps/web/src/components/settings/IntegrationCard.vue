<script setup lang="ts">
import BaseBadge from '@/components/ui/BaseBadge.vue';

/**
 * One connection, and whether it is working.
 *
 * The state is three-way rather than two, because "not set up" and "set up but
 * failing" call for completely different actions — one needs a credential, the
 * other needs somebody to look at why. A single red dot for both is the kind of
 * status display that sends people hunting in the wrong place.
 *
 * `detail` carries whatever the module reports about itself: a model name, a
 * host. Never a credential — none of these endpoints returns one, which is what
 * makes this screen safe to show at all.
 */
type State = 'connected' | 'failing' | 'not-configured';

defineProps<{
  name: string;
  description: string;
  state: State;
  detail?: string | null;
  /** Why it is failing, in the module's own words. Shown only when it is. */
  reason?: string | null;
  icon: string;
}>();

const TONES = {
  connected: 'positive',
  failing: 'danger',
  'not-configured': 'neutral',
} as const;

const LABELS = {
  connected: 'Connected',
  failing: 'Not responding',
  'not-configured': 'Not set up',
} as const;
</script>

<template>
  <div class="flex items-start gap-3 rounded-xl bg-surface p-4 ring-1 ring-border-subtle">
    <span
      class="grid size-9 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink-500"
      aria-hidden="true"
    >
      <svg
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.7"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="icon" />
      </svg>
    </span>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="text-sm font-semibold text-ink-900">{{ name }}</h3>
        <BaseBadge :tone="TONES[state]" dot>{{ LABELS[state] }}</BaseBadge>
      </div>

      <p class="mt-0.5 text-xs text-ink-500">{{ description }}</p>

      <p v-if="detail" class="mt-1.5 truncate font-mono text-xs text-ink-700">{{ detail }}</p>

      <p v-if="state === 'failing' && reason" class="mt-1.5 text-xs text-danger-700">
        {{ reason }}
      </p>

      <slot />
    </div>
  </div>
</template>
