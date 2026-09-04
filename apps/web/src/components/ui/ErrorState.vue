<script setup lang="ts">
import BaseButton from './BaseButton.vue';

/**
 * A failed load, with the way out.
 *
 * Always offers a retry: most failures here are a dropped connection or an
 * expired token, and a person who can press "try again" does not have to
 * reload the whole application to find out which it was.
 */
withDefaults(defineProps<{ message?: string | null; title?: string; retrying?: boolean }>(), {
  message: null,
  title: 'Something went wrong',
  retrying: false,
});

const emit = defineEmits<{ retry: [] }>();
</script>

<template>
  <div role="alert" class="flex flex-col items-center gap-3 px-6 py-10 text-center">
    <span
      class="grid size-12 place-items-center rounded-full bg-danger-50 text-danger-600"
      aria-hidden="true"
    >
      <svg
        class="size-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.6"
        stroke-linecap="round"
      >
        <path d="M12 8v5M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      </svg>
    </span>
    <p class="text-sm font-medium text-ink-900">{{ title }}</p>
    <p v-if="message" class="max-w-md text-sm text-ink-500">{{ message }}</p>
    <BaseButton variant="secondary" size="sm" :loading="retrying" @click="emit('retry')">
      Try again
    </BaseButton>
  </div>
</template>
