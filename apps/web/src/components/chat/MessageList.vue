<script setup lang="ts">
import type { Message } from '@hadiya/shared';
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import type { PendingMessage } from '@/stores/chat';
import LoadingSkeleton from '@/components/ui/LoadingSkeleton.vue';
import AssistantMessage from './AssistantMessage.vue';
import ScrollToBottom from './ScrollToBottom.vue';
import TypingIndicator from './TypingIndicator.vue';
import UserMessage from './UserMessage.vue';

const props = withDefaults(
  defineProps<{
    messages: Message[];
    pending?: PendingMessage | null;
    thinking?: boolean;
    busy?: boolean;
    isLoading?: boolean;
    isLoadingOlder?: boolean;
    hasOlder?: boolean;
    /**
     * Whether the live slot is showing something.
     *
     * The three-dot indicator means "nothing to report yet". Once the run has
     * a step or a sentence to show, that is the report, and keeping the dots
     * beside it would be two answers to the same question.
     */
    hasLiveContent?: boolean;
  }>(),
  {
    pending: null,
    thinking: false,
    busy: false,
    isLoading: false,
    isLoadingOlder: false,
    hasOlder: false,
    hasLiveContent: false,
  },
);

const emit = defineEmits<{ loadOlder: []; regenerate: []; reply: [text: string] }>();

/**
 * The transcript.
 *
 * Two scroll behaviours matter and they pull in opposite directions. New
 * messages should bring the view to the bottom — but only if the person was
 * already there, because yanking somebody away from a paragraph they are
 * reading is worse than making them press a button. And loading older messages
 * must *keep* the reading position: prepending a page without correcting the
 * offset throws the view up by a screenful, which is the single most common way
 * an infinite-scroll chat becomes unusable.
 *
 * Older pages load when the top comes into view rather than on a button,
 * because that is how a conversation is read backwards.
 */
const NEAR_BOTTOM_PX = 120;

const viewport = ref<HTMLElement | null>(null);
const sentinel = ref<HTMLElement | null>(null);
const isAtBottom = ref(true);

const lastAssistantId = computed(
  () => [...props.messages].reverse().find((message) => message.role === 'assistant')?.id ?? null,
);

/**
 * Nothing has been said yet.
 *
 * The empty state is a slot rather than a branch around the whole list, so a
 * failure on the very first turn still has somewhere to render: the footer
 * stays mounted, and an error on an empty thread is exactly when somebody most
 * needs to see one.
 */
const isEmpty = computed(
  () => props.messages.length === 0 && !props.pending && !props.thinking && !props.isLoading,
);

const scrollToBottom = (behavior: 'auto' | 'smooth' = 'auto'): void => {
  const element = viewport.value;

  if (element) {
    element.scrollTo({ top: element.scrollHeight, behavior });
  }
};

const onScroll = (): void => {
  const element = viewport.value;

  if (!element) {
    return;
  }

  isAtBottom.value =
    element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_PX;
};

/**
 * Loads the previous page and puts the reader back where they were.
 *
 * The correction is the difference in scroll height across the update, which is
 * exactly how much content was inserted above them.
 */
const loadOlder = async (): Promise<void> => {
  const element = viewport.value;

  if (!element || props.isLoadingOlder || !props.hasOlder) {
    return;
  }

  const before = element.scrollHeight;
  emit('loadOlder');
  await nextTick();
  element.scrollTop += element.scrollHeight - before;
};

// New content follows the person's intent rather than overriding it.
watch(
  () => [props.messages.length, props.pending?.id, props.thinking, props.hasLiveContent] as const,
  async () => {
    if (!isAtBottom.value) {
      return;
    }

    await nextTick();
    scrollToBottom();
  },
);

onMounted(async () => {
  await nextTick();
  scrollToBottom();

  // `IntersectionObserver` is missing in some test environments; without it the
  // transcript simply does not auto-load older pages, which is a degradation
  // rather than a failure.
  if (typeof IntersectionObserver !== 'function' || !sentinel.value) {
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        void loadOlder();
      }
    },
    { root: viewport.value, rootMargin: '120px' },
  );

  observer.observe(sentinel.value);
});

defineExpose({ scrollToBottom });
</script>

<template>
  <div class="relative min-h-0 flex-1">
    <div
      ref="viewport"
      class="h-full overflow-y-auto overscroll-contain px-4 py-6 sm:px-6"
      tabindex="-1"
      @scroll.passive="onScroll"
    >
      <div class="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <div v-if="hasOlder" ref="sentinel" class="flex justify-center py-1">
          <span v-if="isLoadingOlder" class="text-xs text-ink-500" role="status">
            Loading earlier messages…
          </span>
        </div>

        <LoadingSkeleton v-if="isLoading" variant="card" :rows="3" />

        <template v-else>
          <slot v-if="isEmpty" name="empty" />

          <template v-for="message in messages" :key="message.id">
            <UserMessage
              v-if="message.role === 'user'"
              :content="message.content"
              :created-at="message.createdAt"
            />
            <AssistantMessage
              v-else
              :message="message"
              :is-last="message.id === lastAssistantId"
              :busy="busy"
              @regenerate="emit('regenerate')"
              @reply="emit('reply', $event)"
            />
          </template>

          <UserMessage
            v-if="pending"
            :content="pending.content"
            :created-at="pending.createdAt"
            pending
          />

          <!-- What is happening right now: the ledger, the answer as it is
               written, and anything waiting on a person. Rendered here rather
               than inside a message because none of it is a message yet — the
               transcript takes over the moment the turn is stored. -->
          <slot name="live" />

          <div
            v-if="thinking && !hasLiveContent"
            class="group/message flex w-full gap-4 pb-2 justify-start"
          >
            <span
              class="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 text-[12px] font-bold text-white shadow-sm ring-1 ring-brand-100 dark:ring-surface-raised"
              aria-hidden="true"
            >
              H
            </span>
            <TypingIndicator />
          </div>
        </template>

        <slot name="footer" />
      </div>
    </div>

    <ScrollToBottom :visible="!isAtBottom" @click="scrollToBottom('smooth')" />
  </div>
</template>
