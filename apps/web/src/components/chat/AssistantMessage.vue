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
    <div class="min-w-0 px-2 py-1">
      <MessageRenderer :blocks="blocks" :disabled="busy" @reply="emit('reply', $event)" />
    </div>

    <template #actions>
      <button
        v-if="canCopy"
        type="button"
        class="flex items-center gap-1.5 rounded-md px-2 py-1 opacity-0 transition-all hover:bg-surface-muted hover:text-ink-900 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-500 group-hover/message:opacity-100 text-ink-500"
        @click="copy"
      >
        <svg v-if="!copied" class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
        <svg v-else class="size-3.5 text-brand-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
        {{ copied ? 'Copied' : 'Copy' }}
      </button>

      <button
        v-if="isLast"
        type="button"
        class="flex items-center gap-1.5 rounded-md px-2 py-1 opacity-0 transition-all hover:bg-surface-muted hover:text-ink-900 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-brand-500 group-hover/message:opacity-100 disabled:cursor-not-allowed disabled:opacity-40 text-ink-500"
        :disabled="busy"
        @click="emit('regenerate')"
      >
        <svg class="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
        </svg>
        Regenerate
      </button>
    </template>
  </MessageBubble>
</template>
