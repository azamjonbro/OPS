<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { useAuthStore } from '@/stores/auth';
import { useConversationsStore } from '@/stores/conversations';
import ConversationList from './ConversationList.vue';

/**
 * The chat's own navigation.
 *
 * It is not the application menu with a chat bolted on: the thing being
 * navigated here is the conversation history, and the handful of links at the
 * foot are the places a conversation sends somebody — the reminders it set, the
 * content it wrote, the notifications it raised.
 *
 * Search is debounced and goes to the API's own `search` parameter rather than
 * filtering what happens to be loaded, so it finds a thread from March that was
 * never fetched.
 */
defineProps<{ activeId: string | null }>();

const emit = defineEmits<{
  newChat: [];
  open: [id: string];
  remove: [conversation: Conversation];
  navigate: [];
}>();

const conversations = useConversationsStore();
const auth = useAuthStore();

// The field updates as they type; the watcher fires only once they stop, so a
// four-letter search is one request rather than four.
const search = useDebouncedRef('', 350);

watch(search, (value) => {
  void conversations.setSearch(value);
});

onMounted(() => {
  if (conversations.conversations.length === 0) {
    void conversations.load();
  }
});

const LINKS = [
  {
    label: 'Reminders',
    to: { name: 'reminders' },
    icon: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  },
  {
    label: 'Content',
    to: { name: 'content-plans' },
    icon: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
  },
  {
    label: 'Notifications',
    to: { name: 'notifications' },
    icon: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  },
  {
    label: 'Settings',
    to: { name: 'settings' },
    icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  },
] as const;

const rename = (id: string, title: string): void => {
  void conversations.rename(id, title);
};

const archive = (id: string): void => {
  void conversations.archive(id);
};
</script>

<template>
  <aside class="flex h-full w-72 flex-col bg-slate-900 text-slate-300" aria-label="Conversations">
    <div class="flex h-16 shrink-0 items-center gap-3 px-4">
      <RouterLink
        :to="{ name: 'dashboard' }"
        class="flex items-center gap-3"
        @click="emit('navigate')"
      >
        <span
          class="grid size-9 shrink-0 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white"
          aria-hidden="true"
        >
          H
        </span>
        <span class="text-base font-semibold text-white">Hadiya</span>
      </RouterLink>
    </div>

    <div class="shrink-0 space-y-2 px-3 pb-3">
      <button
        type="button"
        class="flex w-full items-center gap-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-400"
        @click="emit('newChat')"
      >
        <svg
          class="size-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
        New chat
      </button>

      <div class="relative">
        <label for="conversation-search" class="sr-only">Search conversations</label>
        <svg
          class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-slate-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="m21 21-4.3-4.3M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
        </svg>
        <input
          id="conversation-search"
          v-model="search"
          type="search"
          placeholder="Search conversations"
          class="w-full rounded-lg bg-slate-800 py-2 pl-8 pr-3 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      </div>
    </div>

    <nav class="min-h-0 flex-1 overflow-y-auto px-3 pb-4" aria-label="Conversation history">
      <p v-if="conversations.isLoading" class="px-2.5 py-3 text-xs text-slate-500" role="status">
        Loading conversations…
      </p>

      <p v-else-if="conversations.error" class="px-2.5 py-3 text-xs text-red-400" role="alert">
        {{ conversations.error }}
      </p>

      <p v-else-if="conversations.isEmpty" class="px-2.5 py-3 text-xs text-slate-500">
        {{ search ? 'No conversation matches that.' : 'No conversations yet.' }}
      </p>

      <ConversationList
        v-else
        :groups="conversations.grouped"
        :active-id="activeId"
        :has-more="conversations.hasMore"
        :is-loading-more="conversations.isLoadingMore"
        @open="emit('open', $event)"
        @rename="rename"
        @archive="archive"
        @remove="emit('remove', $event)"
        @load-more="conversations.loadMore()"
      />
    </nav>

    <div class="shrink-0 border-t border-slate-800 px-3 py-2">
      <ul class="space-y-0.5">
        <li v-for="link in LINKS" :key="link.label">
          <RouterLink
            :to="link.to"
            class="flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            @click="emit('navigate')"
          >
            <svg
              class="size-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.7"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path :d="link.icon" />
            </svg>
            {{ link.label }}
          </RouterLink>
        </li>
      </ul>
    </div>

    <div class="flex shrink-0 items-center gap-3 border-t border-slate-800 px-4 py-3">
      <span
        class="grid size-8 shrink-0 place-items-center rounded-full bg-slate-800 text-xs font-semibold text-slate-200"
        aria-hidden="true"
      >
        {{ auth.user?.fullName?.charAt(0).toUpperCase() ?? '?' }}
      </span>
      <span class="min-w-0">
        <span class="block truncate text-sm font-medium text-white">
          {{ auth.user?.fullName ?? 'Not signed in' }}
        </span>
        <span class="block truncate text-xs capitalize text-slate-500">
          {{ auth.user?.role ?? 'no session' }}
        </span>
      </span>
    </div>
  </aside>
</template>
