<script setup lang="ts">
/** One row of a dropdown: a button or a link, styled the same either way. */
withDefaults(defineProps<{ danger?: boolean; as?: 'button' | 'div' }>(), {
  danger: false,
  as: 'button',
});
</script>

<template>
  <component
    :is="as"
    :type="as === 'button' ? 'button' : undefined"
    role="menuitem"
    class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-muted"
    :class="danger ? 'text-danger-600' : 'text-ink-700'"
  >
    <slot />
  </component>
</template>
