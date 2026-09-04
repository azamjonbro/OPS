<script setup lang="ts">
/**
 * What a page shows when there is genuinely nothing.
 *
 * Distinct from the error state on purpose: "no products yet" and "the products
 * could not be loaded" call for completely different actions, and a blank panel
 * that could mean either is the worst of both.
 */
withDefaults(defineProps<{ title: string; description?: string; icon?: string }>(), {
  description: undefined,
  icon: 'M20 7 12 3 4 7v10l8 4 8-4zM4 7l8 4 8-4M12 11v10',
});
</script>

<template>
  <div class="flex flex-col items-center gap-3 px-6 py-12 text-center">
    <span
      class="grid size-12 place-items-center rounded-full bg-surface-muted text-ink-400"
      aria-hidden="true"
    >
      <svg
        class="size-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path :d="icon" />
      </svg>
    </span>
    <p class="text-sm font-medium text-ink-900">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-sm text-ink-500">{{ description }}</p>
    <slot />
  </div>
</template>
