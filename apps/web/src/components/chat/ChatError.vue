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
    class="flex flex-wrap items-center gap-4 rounded-[14px] bg-danger-50 px-4 py-3.5 text-[14px] font-medium text-danger-900 ring-1 ring-danger-600/20 shadow-sm"
  >
    <div class="grid size-8 shrink-0 place-items-center rounded-lg bg-danger-100 text-danger-600">
      <svg
        class="size-4"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path
          d="M12 8v5M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
        />
      </svg>
    </div>

    <p class="min-w-0 flex-1">{{ message }}</p>

    <BaseButton
      v-if="retriable"
      variant="secondary"
      size="sm"
      :loading="retrying"
      class="!rounded-lg !bg-white hover:!bg-danger-50"
      @click="emit('retry')"
    >
      Try again
    </BaseButton>
    <BaseButton
      v-else
      variant="ghost"
      size="sm"
      class="!rounded-lg text-danger-700 hover:text-danger-900"
      @click="emit('dismiss')"
      >Dismiss</BaseButton
    >
  </div>
</template>
