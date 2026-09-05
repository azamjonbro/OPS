<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';

import type { ConversationGroup } from '@/stores/conversations';
import ConversationItem from './ConversationItem.vue';

defineProps<{
  groups: Array<{ title: ConversationGroup; items: Conversation[] }>;
  activeId: string | null;
  hasMore: boolean;
  isLoadingMore: boolean;
}>();

const emit = defineEmits<{
  open: [id: string];
  rename: [id: string, title: string];
  archive: [id: string];
  remove: [conversation: Conversation];
  loadMore: [];
}>();
</script>

<template>
  <div class="flex flex-col gap-1">
    <section v-for="group in groups" :key="group.title" class="mb-4 first:mt-2 last:mb-0">
      <h3
        class="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-ink-400 select-none"
      >
        {{ group.title }}
      </h3>
      <ul class="space-y-0.5">
        <ConversationItem
          v-for="conversation in group.items"
          :key="conversation.id"
          :conversation="conversation"
          :active="conversation.id === activeId"
          @open="emit('open', $event)"
          @rename="(id, title) => emit('rename', id, title)"
          @archive="emit('archive', $event)"
          @remove="emit('remove', $event)"
        />
      </ul>
    </section>

    <button
      v-if="hasMore"
      type="button"
      class="mx-2.5 mt-2 rounded-lg py-2 text-[12px] font-medium text-ink-500 transition-colors hover:bg-surface hover:text-ink-900 disabled:opacity-50"
      :disabled="isLoadingMore"
      @click="emit('loadMore')"
    >
      {{ isLoadingMore ? 'Loading…' : 'Load older' }}
    </button>
  </div>
</template>
