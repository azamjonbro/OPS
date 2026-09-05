<script setup lang="ts">
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * The assistant needs an answer before it can go on.
 *
 * Two situations produce this and they are deliberately drawn the same: a tool
 * that will destroy something and is waiting to be told to, and a tool that
 * could not work out what was meant ("this evening" — which hour?). In both the
 * conversation is blocked on a person, and in both the way forward is to say so.
 *
 * The buttons are shortcuts for typing, not a separate approval channel: each
 * sends an ordinary message to the same endpoint with the same conversation id.
 * A confirmation that bypassed the model would be a second path to a
 * destructive tool, and the registry's guard exists precisely so there is only
 * one.
 */
defineProps<{ question: string; disabled?: boolean }>();

const emit = defineEmits<{ reply: [text: string] }>();
</script>

<template>
  <div
    class="flex flex-col gap-3 rounded-xl bg-warning-50 px-4 py-3 ring-1 ring-warning-600/25"
    role="group"
    aria-label="Hadiya needs an answer"
  >
    <p class="flex items-start gap-2.5 text-sm text-warning-700">
      <svg
        class="mt-0.5 size-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        aria-hidden="true"
      >
        <path
          d="M12 17h.01M9.1 9a3 3 0 1 1 4.2 2.7c-.8.4-1.3 1.2-1.3 2.1M12 22a10 10 0 1 1 0-20 10 10 0 0 1 0 20Z"
        />
      </svg>
      <span class="min-w-0">{{ question }}</span>
    </p>

    <div class="flex flex-wrap gap-2">
      <BaseButton size="sm" :disabled="disabled" @click="emit('reply', 'Ha, davom et')">
        Yes, go ahead
      </BaseButton>
      <BaseButton
        variant="secondary"
        size="sm"
        :disabled="disabled"
        @click="emit('reply', 'Yo‘q, bekor qil')"
      >
        No, cancel
      </BaseButton>
    </div>
  </div>
</template>
