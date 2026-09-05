<script setup lang="ts">
import type { Conversation } from '@hadiya/shared';
import { onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';

import { useDebouncedRef } from '@/composables/useDebouncedRef';
import { useAuthStore } from '@/stores/auth';
import { useConversationsStore } from '@/stores/conversations';
import ConversationList from './ConversationList.vue';

defineProps<{ activeId: string | null }>();

const emit = defineEmits<{
  newChat: [];
  open: [id: string];
  remove: [conversation: Conversation];
  navigate: [];
}>();

const conversations = useConversationsStore();
const auth = useAuthStore();
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
  <aside
    class="flex h-full w-[260px] flex-col bg-surface-muted border-r border-border-subtle text-ink-900 font-sans"
    aria-label="Conversations"
  >
    <!-- Header -->
    <div class="flex h-[72px] shrink-0 items-center justify-between px-4">
      <RouterLink
        :to="{ name: 'dashboard' }"
        class="flex items-center gap-3 transition-opacity hover:opacity-80"
        @click="emit('navigate')"
      >
        <span
          class="grid size-8 shrink-0 place-items-center rounded-[10px] bg-brand-600 text-sm font-bold text-white shadow-sm"
          aria-hidden="true"
        >
          H
        </span>
        <span class="text-[15px] font-semibold tracking-tight text-ink-900">Hadiya</span>
      </RouterLink>
      <!-- New Chat Button inside Header for minimal look -->
      <button
        type="button"
        class="flex size-8 items-center justify-center rounded-lg text-ink-500 hover:bg-surface hover:text-ink-900 focus:outline-none focus:ring-2 focus:ring-brand-500"
        title="New Chat"
        @click="emit('newChat')"
      >
        <svg
          class="size-[18px]"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
    </div>

    <!-- Search -->
    <div class="shrink-0 px-3 pb-4 pt-1">
      <div class="relative group">
        <label for="conversation-search" class="sr-only">Search conversations</label>
        <svg
          class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-400 transition-colors group-focus-within:text-brand-500"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          aria-hidden="true"
        >
          <path d="m21 21-4.3-4.3M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />
        </svg>
        <input
          id="conversation-search"
          v-model="search"
          type="search"
          placeholder="Search..."
          class="w-full rounded-xl border border-transparent bg-surface px-3 py-2 pl-9 text-[13px] text-ink-900 placeholder:text-ink-400 shadow-sm transition-all focus:border-brand-500 focus:bg-surface focus:outline-none focus:ring-1 focus:ring-brand-500 hover:border-border-subtle"
        />
      </div>
    </div>

    <!-- Conversation List -->
    <nav
      class="min-h-0 flex-1 overflow-y-auto px-2 pb-4 custom-scrollbar"
      aria-label="Conversation history"
    >
      <p v-if="conversations.isLoading" class="px-3 py-3 text-[13px] text-ink-500" role="status">
        Loading...
      </p>

      <p v-else-if="conversations.error" class="px-3 py-3 text-[13px] text-danger-600" role="alert">
        {{ conversations.error }}
      </p>

      <p v-else-if="conversations.isEmpty" class="px-3 py-3 text-[13px] text-ink-500">
        {{ search ? 'No results found.' : 'No conversations yet.' }}
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

    <!-- App Links -->
    <div class="shrink-0 border-t border-border-subtle px-2 py-2">
      <ul class="space-y-0.5">
        <li v-for="link in LINKS" :key="link.label">
          <RouterLink
            :to="link.to"
            class="group flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium text-ink-500 transition-all hover:bg-surface hover:text-ink-900"
            @click="emit('navigate')"
          >
            <svg
              class="size-[15px] shrink-0 text-ink-400 transition-colors group-hover:text-ink-700"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
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

    <!-- User Profile -->
    <div
      class="flex shrink-0 items-center gap-3 p-4 border-t border-border-subtle hover:bg-surface transition-colors cursor-pointer rounded-b-lg"
    >
      <span
        class="grid size-8 shrink-0 place-items-center rounded-full bg-brand-500 text-[11px] font-bold text-white shadow-sm"
        aria-hidden="true"
      >
        {{ auth.user?.fullName?.charAt(0).toUpperCase() ?? '?' }}
      </span>
      <span class="min-w-0">
        <span class="block truncate text-[13px] font-semibold text-ink-900 leading-tight">
          {{ auth.user?.fullName ?? 'Not signed in' }}
        </span>
        <span
          class="block truncate text-[11px] font-medium text-ink-500 capitalize leading-tight mt-0.5"
        >
          {{ auth.user?.role ?? 'User' }}
        </span>
      </span>
    </div>
  </aside>
</template>

<style scoped>
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: var(--color-border-strong);
  border-radius: 10px;
}
.custom-scrollbar:hover::-webkit-scrollbar-thumb {
  background-color: var(--color-ink-400);
}
.custom-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: var(--color-border-strong) transparent;
}
</style>
