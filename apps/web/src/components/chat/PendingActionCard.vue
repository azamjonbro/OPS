<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';

import type { PendingConfirmation } from '@/chat/agent-run';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * Something Hadiya has prepared and will not do until it is told to.
 *
 * The card is a *statement of intent*, not a dialogue box: it says what will
 * happen, where, and how long the offer stands, and then waits. It never
 * appears for a read — only for the writes the server itself stopped and asked
 * about, which is why it can be trusted to mean something when it does appear.
 *
 * Pressing a button here is not authorisation. It sends an ordinary message
 * into the same conversation, the model reads it, and the server's own
 * confirmation gate then checks the agreement against the action it recorded.
 * A frontend that could authorise would be a second path to a destructive tool,
 * and the whole point of the gate is that there is only one.
 *
 * The clock is real. An offer that has run out is not merely styled as stale:
 * the buttons go, because pressing them would send a "yes" the server is
 * required to refuse, and offering an action that cannot succeed is worse than
 * offering none.
 */
const props = defineProps<{ confirmation: PendingConfirmation; disabled?: boolean }>();

const emit = defineEmits<{ reply: [text: string] }>();

const now = ref(Date.now());
const timer = setInterval(() => {
  now.value = Date.now();
}, 1_000);

onBeforeUnmount(() => {
  clearInterval(timer);
});

const remainingMs = computed(() => Date.parse(props.confirmation.expiresAt) - now.value);
const hasExpired = computed(() => remainingMs.value <= 0);

/** "4 min left" while there is time; nothing once there is not. */
const remaining = computed(() => {
  const seconds = Math.max(0, Math.round(remainingMs.value / 1_000));

  if (seconds >= 120) {
    return `${String(Math.round(seconds / 60))} min left`;
  }

  return seconds > 0 ? `${String(seconds)}s left` : '';
});
</script>

<template>
  <div
    class="my-2 w-full max-w-[34rem] overflow-hidden rounded-[14px] bg-surface ring-1 ring-warning-600/30"
    role="group"
    :aria-label="`Confirm: ${confirmation.title}`"
  >
    <div class="flex items-start gap-3 px-4 pt-3.5">
      <span
        class="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-warning-50 text-warning-700"
        aria-hidden="true"
      >
        <svg
          class="size-3"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        >
          <path d="M8 4v4.5M8 11.5h.01" />
        </svg>
      </span>

      <div class="min-w-0 flex-1">
        <p class="text-[14px] font-medium text-ink-900">{{ confirmation.title }}</p>
        <p class="mt-1 text-[13px] leading-relaxed text-ink-600">
          Hadiya will {{ confirmation.description }}. It has not done it yet.
        </p>
      </div>

      <span v-if="confirmation.integration" class="shrink-0 pt-0.5 text-[11px] text-ink-400">
        {{ confirmation.integration }}
      </span>
    </div>

    <div
      class="mt-3 flex flex-wrap items-center gap-2 border-t border-border-subtle bg-surface-muted px-4 py-2.5"
    >
      <template v-if="hasExpired">
        <p class="text-[13px] text-ink-500">
          This has been waiting too long to go ahead on. Ask again and Hadiya will re-check the
          details.
        </p>
      </template>

      <template v-else>
        <BaseButton size="sm" :disabled="disabled" @click="emit('reply', 'Ha, davom et')">
          Go ahead
        </BaseButton>
        <BaseButton
          variant="secondary"
          size="sm"
          :disabled="disabled"
          @click="emit('reply', 'Yo‘q, bekor qil')"
        >
          Don't
        </BaseButton>

        <span v-if="remaining" class="ml-auto text-[11px] text-ink-400" aria-live="off">
          {{ remaining }}
        </span>
      </template>
    </div>
  </div>
</template>
