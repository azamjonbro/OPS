<script setup lang="ts">
import type { Message } from '@hadiya/shared';
import { computed, ref } from 'vue';

import { toBlocks } from '@/chat/message-content';
import { useToast } from '@/composables/useToast';
import MessageBubble from './MessageBubble.vue';
import MessageRenderer from './MessageRenderer.vue';

/**
 * One assistant turn.
 *
 * The message is translated into blocks once, here, and everything below only
 * ever renders blocks. Copying takes the *text* rather than the whole turn,
 * because that is what somebody wants to paste into a caption — an image or a
 * table has its own home and would come across as nothing useful.
 *
 * Regenerating is offered only on the last turn: asking for a fresh answer to
 * something three questions ago would be re-asking the wrong question, and the
 * API has no concept of rewinding a thread.
 */
const props = withDefaults(defineProps<{ message: Message; isLast?: boolean; busy?: boolean }>(), {
  isLast: false,
  busy: false,
});

const emit = defineEmits<{ regenerate: []; reply: [text: string] }>();

const toast = useToast();
const copied = ref(false);

const blocks = computed(() => toBlocks(props.message));
const canCopy = computed(() => props.message.content.trim().length > 0);

const copy = async (): Promise<void> => {
  try {
    await navigator.clipboard.writeText(props.message.content);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1_500);
  } catch {
    // A browser that refuses clipboard access (no permission, or an insecure
    // origin) should say so rather than appear to have copied nothing.
    toast.error('The answer could not be copied.');
  }
};
</script>

<template>
  <MessageBubble role="assistant" :created-at="message.createdAt">
    <div class="min-w-0 rounded-2xl rounded-tl-md bg-surface px-4 py-3 ring-1 ring-border-subtle">
      <MessageRenderer :blocks="blocks" :disabled="busy" @reply="emit('reply', $event)" />
    </div>

    <template #actions>
      <button
        v-if="canCopy"
        type="button"
        class="rounded px-1.5 py-0.5 opacity-0 transition-opacity hover:text-ink-700 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand-600 group-hover/message:opacity-100"
        @click="copy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </button>

      <button
        v-if="isLast"
        type="button"
        class="rounded px-1.5 py-0.5 opacity-0 transition-opacity hover:text-ink-700 focus:opacity-100 focus:outline-none focus:ring-1 focus:ring-brand-600 group-hover/message:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
        :disabled="busy"
        @click="emit('regenerate')"
      >
        Regenerate
      </button>
    </template>
  </MessageBubble>
</template>
