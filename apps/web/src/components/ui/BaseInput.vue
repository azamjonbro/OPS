<script setup lang="ts">
import { computed, useId } from 'vue';

const props = withDefaults(
  defineProps<{
    label?: string;
    type?: string;
    placeholder?: string;
    hint?: string;
    error?: string | null;
    required?: boolean;
    disabled?: boolean;
    min?: number | string;
    max?: number | string;
    step?: number | string;
    maxlength?: number;
    autocomplete?: string;
    inputmode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'search' | 'email';
  }>(),
  {
    label: undefined,
    type: 'text',
    placeholder: undefined,
    hint: undefined,
    error: null,
    required: false,
    disabled: false,
    min: undefined,
    max: undefined,
    step: undefined,
    maxlength: undefined,
    autocomplete: undefined,
    inputmode: undefined,
  },
);

/**
 * A labelled text input.
 *
 * The label is part of the component rather than left to each page, because a
 * placeholder is not a label: it disappears on focus and screen readers do not
 * announce it as one. `describedby` wires the hint and the error to the field
 * so both are read out, and `aria-invalid` marks the field itself.
 *
 * The model is always a string, even for `type="number"`. Vue's own `v-model`
 * coerces a number field to a number, which means a caller that trims or
 * pattern-matches the value crashes the moment somebody types a digit — so the
 * value is bound and read manually here, once, rather than every form having to
 * defend against it.
 */
const model = defineModel<string>({ default: '' });

const id = useId();
const hintId = `${id}-hint`;
const errorId = `${id}-error`;

const describedBy = computed(
  () =>
    [props.hint ? hintId : '', props.error ? errorId : ''].filter(Boolean).join(' ') || undefined,
);
</script>

<template>
  <div class="flex flex-col gap-1">
    <label v-if="label" :for="id" class="text-xs font-medium text-ink-700">
      {{ label }}
      <span v-if="required" class="text-danger-600" aria-hidden="true">*</span>
    </label>

    <input
      :id="id"
      :value="model"
      :type="type"
      :placeholder="placeholder"
      :required="required"
      :disabled="disabled"
      :min="min"
      :max="max"
      :step="step"
      :maxlength="maxlength"
      :autocomplete="autocomplete"
      :inputmode="inputmode"
      :aria-invalid="error ? 'true' : undefined"
      :aria-describedby="describedBy"
      class="h-10 w-full rounded-lg bg-surface px-3 text-sm text-ink-900 ring-1 ring-inset transition-shadow placeholder:text-ink-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
      :class="
        error ? 'ring-danger-600 focus:ring-danger-600' : 'ring-border-subtle focus:ring-brand-600'
      "
      @input="model = ($event.target as HTMLInputElement).value"
    />

    <p v-if="error" :id="errorId" class="text-xs text-danger-600">{{ error }}</p>
    <p v-else-if="hint" :id="hintId" class="text-xs text-ink-500">{{ hint }}</p>
  </div>
</template>
