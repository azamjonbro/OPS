<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * A turn that did not go through.
 *
 * Whatever failed — the network, the AI provider, a timeout — the person is
 * told what to do next and never what the server thinks happened. The message
 * comes from `toErrorMessage`, which is where API responses are turned into
 * sentences; nothing here formats a status code, a request id or a stack.
 *
 * It sits inline in the transcript rather than in a toast, because the failed
 * turn is a thing that belongs at that point in the conversation, and the retry
 * has to be somewhere it can still be found a minute later.
 */
withDefaults(defineProps<{ message: string; retrying?: boolean; retriable?: boolean }>(), {
  retrying: false,
  retriable: true,
});

const emit = defineEmits<{ retry: []; dismiss: [] }>();
</script>

<template>
  <div
    role="alert"
    class="flex flex-wrap items-center gap-3 rounded-xl bg-danger-50 px-4 py-3 text-sm text-danger-700 ring-1 ring-danger-600/25"
  >
    <svg
      class="size-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      aria-hidden="true"
    >
      <path
        d="M12 8v5M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
      />
    </svg>

    <p class="min-w-0 flex-1">{{ message }}</p>

    <BaseButton
      v-if="retriable"
      variant="secondary"
      size="sm"
      :loading="retrying"
      @click="emit('retry')"
    >
      Try again
    </BaseButton>
    <BaseButton v-else variant="ghost" size="sm" @click="emit('dismiss')">Dismiss</BaseButton>
  </div>
</template>
