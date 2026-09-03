<script setup lang="ts">
import { computed } from 'vue';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md';

const props = withDefaults(
  defineProps<{
    variant?: Variant;
    size?: Size;
    type?: 'button' | 'submit';
    disabled?: boolean;
    loading?: boolean;
    block?: boolean;
  }>(),
  { variant: 'primary', size: 'md', type: 'button', disabled: false, loading: false, block: false },
);

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white hover:bg-brand-700 disabled:hover:bg-brand-600',
  secondary:
    'bg-white text-ink-900 ring-1 ring-inset ring-border-subtle hover:bg-surface-muted disabled:hover:bg-white',
  ghost: 'text-ink-700 hover:bg-surface-muted disabled:hover:bg-transparent',
};

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
};

const classes = computed(() => [
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-60',
  VARIANT_CLASSES[props.variant],
  SIZE_CLASSES[props.size],
  props.block ? 'w-full' : '',
]);
</script>

<template>
  <button :type="type" :class="classes" :disabled="disabled || loading">
    <svg
      v-if="loading"
      class="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
    </svg>
    <slot />
  </button>
</template>
