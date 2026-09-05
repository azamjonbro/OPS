<script setup lang="ts">
import { computed } from 'vue';

import { formatDateTime } from '@/utils/format';

/**
 * The shell every turn sits in: who said it, when, and the actions on it.
 *
 * Only the frame lives here — what is *inside* is a slot, so the user and
 * assistant components differ in content without either re-implementing the
 * avatar, the timestamp or the hover behaviour.
 *
 * The timestamp is shown on hover and focus rather than always, because a
 * clock against every line turns a conversation into a log. It stays reachable
 * from the keyboard, so it is not mouse-only information.
 */
const props = withDefaults(
  defineProps<{ role: 'user' | 'assistant'; createdAt?: string | null; pending?: boolean }>(),
  { createdAt: null, pending: false },
);

const isUser = computed(() => props.role === 'user');
const timestamp = computed(() => (props.createdAt ? formatDateTime(props.createdAt) : null));
</script>

<template>
  <article
    class="group/message flex w-full gap-3"
    :class="[isUser ? 'justify-end' : 'justify-start', pending ? 'opacity-70' : '']"
  >
    <span
      v-if="!isUser"
      class="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white"
      aria-hidden="true"
    >
      H
    </span>

    <div class="flex min-w-0 flex-col gap-1" :class="isUser ? 'max-w-[85%] items-end' : 'flex-1'">
      <p class="sr-only">{{ isUser ? 'You said' : 'Hadiya said' }}</p>

      <slot />

      <div class="flex items-center gap-2 text-[0.6875rem] text-ink-400">
        <time
          v-if="timestamp"
          class="opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100"
          :datetime="createdAt ?? undefined"
        >
          {{ timestamp }}
        </time>
        <slot name="actions" />
      </div>
    </div>
  </article>
</template>
