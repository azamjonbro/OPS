<script setup lang="ts">
withDefaults(defineProps<{ title?: string; description?: string }>(), {
  title: undefined,
  description: undefined,
});
</script>

<template>
  <section class="rounded-xl bg-surface ring-1 ring-border-subtle">
    <header
      v-if="title || $slots.header"
      class="flex items-start justify-between gap-4 border-b border-border-subtle px-5 py-4"
    >
      <div>
        <h2 v-if="title" class="text-sm font-semibold text-ink-900">{{ title }}</h2>
        <p v-if="description" class="mt-0.5 text-sm text-ink-500">{{ description }}</p>
      </div>
      <slot name="header" />
    </header>
    <div class="px-5 py-4">
      <slot />
    </div>
  </section>
</template>
