<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';

import type { ConversationGroup } from '@/stores/conversations';
import ConversationItem from './ConversationItem.vue';

/**
 * The thread list, in date buckets.
 *
 * "Today / Yesterday / Previous 7 days / Older" is how somebody remembers a
 * conversation — by roughly when they had it — and it is the only grouping that
 * needs no explanation.
 *
 * The list is paged. `Load more` is a button rather than an automatic fetch on
 * scroll, because the sidebar is not the thing being read: silently pulling
 * pages while somebody hunts for a thread costs requests for nothing.
 */
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
  <div class="flex flex-col gap-4">
    <section v-for="group in groups" :key="group.title">
      <h3
        class="px-2.5 pb-1.5 text-[0.6875rem] font-semibold uppercase tracking-wider text-slate-500"
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
      class="mx-2.5 rounded-lg py-2 text-xs font-medium text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-60"
      :disabled="isLoadingMore"
      @click="emit('loadMore')"
    >
      {{ isLoadingMore ? 'Loading…' : 'Load more' }}
    </button>
  </div>
</template>
