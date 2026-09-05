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
    class="group/message flex w-full gap-4 pb-2"
    :class="[isUser ? 'justify-end' : 'justify-start', pending ? 'opacity-70' : '']"
  >
    <span
      v-if="!isUser"
      class="mt-1 grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 text-[12px] font-bold text-white shadow-sm ring-1 ring-brand-100 dark:ring-surface-raised"
      aria-hidden="true"
    >
      H
    </span>

    <div class="flex min-w-0 flex-col gap-1.5" :class="isUser ? 'max-w-[75%] md:max-w-[65%] items-end' : 'flex-1 max-w-[85%] md:max-w-[75%]' ">
      <p class="sr-only">{{ isUser ? 'You said' : 'Hadiya said' }}</p>

      <slot />

      <div class="flex items-center gap-3 text-[11px] font-medium text-ink-400 mt-1.5">
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
