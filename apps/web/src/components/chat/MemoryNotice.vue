<script setup lang="ts">
import type { MemorySummary } from '@/stores/chat';
import BaseButton from '@/components/ui/BaseButton.vue';

/**
 * Something the assistant would like to remember, waiting to be allowed to.
 *
 * The backend holds anything it is not confident about as `pending` rather than
 * keeping it quietly, and this is where that decision reaches the person. It is
 * deliberately small and at the foot of the transcript: it is a footnote to the
 * answer, not a modal in the middle of a conversation.
 *
 * Both buttons resolve to a real memory endpoint in the page above, so the
 * choice is stored as the person's. Nothing is decided here, and the frontend
 * holds no memory of its own.
 */
withDefaults(defineProps<{ memories: MemorySummary[]; busyId?: string | null }>(), {
  busyId: null,
});

const emit = defineEmits<{ confirm: [id: string]; forget: [id: string] }>();

const label = (memory: MemorySummary): string =>
  `${memory.key.replace(/_/g, ' ')}: ${memory.value}`;
</script>

<template>
  <aside
    v-if="memories.length > 0"
    class="flex flex-col gap-2.5 rounded-xl bg-surface-muted px-4 py-3 ring-1 ring-border-subtle"
    aria-label="Things Hadiya would like to remember"
  >
    <p class="flex items-center gap-2 text-xs font-medium text-ink-700">
      <svg
        class="size-3.5 shrink-0 text-ink-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path
          d="M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-6H5v-2a7 7 0 1 1 14 0v2h-2v6h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z"
        />
      </svg>
      Shall I remember this for future conversations?
    </p>

    <ul class="flex flex-col gap-2">
      <li
        v-for="memory in memories"
        :key="memory.id"
        class="flex flex-wrap items-center justify-between gap-2"
      >
        <span class="min-w-0 flex-1 text-sm text-ink-900">{{ label(memory) }}</span>

        <span class="flex shrink-0 gap-1.5">
          <BaseButton size="sm" :loading="busyId === memory.id" @click="emit('confirm', memory.id)">
            Remember
          </BaseButton>
          <BaseButton
            variant="ghost"
            size="sm"
            :disabled="busyId === memory.id"
            @click="emit('forget', memory.id)"
          >
            No
          </BaseButton>
        </span>
      </li>
    </ul>
  </aside>
</template>
