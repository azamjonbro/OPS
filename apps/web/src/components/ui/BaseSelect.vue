<script setup lang="ts">
import { computed, useId } from 'vue';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/** A labelled native select — keyboard and screen-reader behaviour for free. */
const model = defineModel<string>({ default: '' });

const props = withDefaults(
  defineProps<{
    label?: string;
    options: SelectOption[];
    placeholder?: string;
    hint?: string;
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
  }>(),
  {
    label: undefined,
    placeholder: undefined,
    hint: undefined,
    error: null,
    required: false,
    disabled: false,
  },
);

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

const describedBy = computed(() =>
  [props.hint ? hintId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined,
);
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" :for="id" class="text-xs font-medium text-ink-700">
      {{ label }}
      <span v-if="required" class="text-danger-600" aria-hidden="true">*</span>
    </label>

    <select
      :id="id"
      v-model="model"
      :required="required"
      :disabled="disabled"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="h-10 w-full rounded-lg bg-surface px-3 text-sm text-ink-900 ring-1 ring-inset focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      :class="error ? 'ring-danger-600 focus:ring-danger-600' : 'ring-border-subtle focus:ring-brand-600'"
    >
      <option v-if="placeholder" value="">{{ placeholder }}</option>
      <option
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        :disabled="option.disabled"
      >
        {{ option.label }}
      </option>
    </select>

    <p v-if="error" :id="errorId" class="text-xs text-danger-600">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="text-xs text-ink-500">{{ hint }}</p>
  </div>
</template>
