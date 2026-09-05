import type { Conversation } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toChatError } from '@/chat/chat-errors';
import { isCancelled } from '@/services/api-error';
import { conversationService } from '@/services/conversation.service';

const PAGE_SIZE = 25;

export type ConversationGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';

const GROUP_ORDER: ConversationGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

/** Which bucket a thread belongs to, by when it was last used. */
export const groupFor = (conversation: Conversation, now = new Date()): ConversationGroup => {
  const stamp = conversation.lastMessageAt ?? conversation.createdAt;
  const when = new Date(stamp);

  if (Number.isNaN(when.getTime())) {
    return 'Older';
  }

  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);

  if (when >= startOfToday) {
    return 'Today';
  }

  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);

  if (when >= startOfYesterday) {
    return 'Yesterday';
  }

  const sevenDaysAgo = new Date(startOfToday);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  return when >= sevenDaysAgo ? 'Previous 7 days' : 'Older';
};

/**
 * The conversation list in the sidebar.
 *
 * Only the list lives here, and deliberately: it is the one piece of chat state
 * two places need at once — the sidebar renders it and the chat view renames
 * and deletes into it. The open thread's *messages* are not here, because
 * nothing outside the transcript reads them and holding them globally would
 * mean every navigation re-rendered a thousand bubbles.
 *
 * Pages are appended rather than replaced, so the sidebar grows as the person
 * scrolls instead of loading a year of history to show today's.
 */
export const useConversationsStore = defineStore('conversations', () => {
  const conversations = ref<Conversation[]>([]);
  const page = ref(1);
  const totalPages = ref(1);
  const total = ref(0);
  const search = ref('');

  const isLoading = ref(false);
  const isLoadingMore = ref(false);
  const error = ref<string | null>(null);

  let controller: AbortController | null = null;

  const hasMore = computed(() => page.value < totalPages.value);
  const isEmpty = computed(() => conversations.value.length === 0);

  /** The list as the sidebar renders it: date buckets, newest first. */
  const grouped = computed(() => {
    const buckets = new Map<ConversationGroup, Conversation[]>();

    for (const conversation of conversations.value) {
      const key = groupFor(conversation);
      buckets.set(key, [...(buckets.get(key) ?? []), conversation]);
    }

    return GROUP_ORDER.flatMap((title) => {
      const items = buckets.get(title);

      return items && items.length > 0 ? [{ title, items }] : [];
    });
  });

  const fetchPage = async (nextPage: number): Promise<void> => {
    controller?.abort();
    controller = new AbortController();

    try {
      const result = await conversationService.list(
        {
          page: nextPage,
          pageSize: PAGE_SIZE,
          status: 'active',
          ...(search.value.trim() ? { search: search.value.trim() } : {}),
        },
        { signal: controller.signal },
      );

      conversations.value =
        nextPage === 1 ? result.items : [...conversations.value, ...result.items];
      page.value = result.pagination.page;
      totalPages.value = result.pagination.totalPages;
      total.value = result.pagination.total;
      error.value = null;
    } catch (caught) {
      if (isCancelled(caught)) {
        return;
      }

      // The same translation the transcript uses: "A bearer token is required"
      // is the server talking to its own logs, not to a shopkeeper.
      error.value = toChatError(caught).message;

      if (nextPage === 1) {
        conversations.value = [];
      }
    }
  };

  const load = async (): Promise<void> => {
    isLoading.value = true;

    try {
      await fetchPage(1);
    } finally {
      isLoading.value = false;
    }
  };

  const loadMore = async (): Promise<void> => {
    if (!hasMore.value || isLoadingMore.value || isLoading.value) {
      return;
    }

    isLoadingMore.value = true;

    try {
      await fetchPage(page.value + 1);
    } finally {
      isLoadingMore.value = false;
    }
  };

  const setSearch = async (term: string): Promise<void> => {
    search.value = term;
    await load();
  };

  /** Puts a thread at the top, or moves it there once it is used again. */
  const upsert = (conversation: Conversation): void => {
    const rest = conversations.value.filter((entry) => entry.id !== conversation.id);
    conversations.value = [conversation, ...rest];
  };

  const rename = async (id: string, title: string): Promise<Conversation> => {
    const updated = await conversationService.rename(id, title);

    conversations.value = conversations.value.map((entry) => (entry.id === id ? updated : entry));

    return updated;
  };

  /**
   * Removes a thread, restoring it if the server refuses.
   *
   * Optimistic because the row vanishing instantly is the whole point of the
   * gesture, and safe because the rollback is exact: the removed entry and its
   * position are both kept until the call comes back.
   */
  const remove = async (id: string): Promise<void> => {
    const index = conversations.value.findIndex((entry) => entry.id === id);
    const removed = conversations.value[index];

    conversations.value = conversations.value.filter((entry) => entry.id !== id);

    try {
      await conversationService.remove(id);
      total.value = Math.max(0, total.value - 1);
    } catch (caught) {
      if (removed) {
        const restored = [...conversations.value];
        restored.splice(index, 0, removed);
        conversations.value = restored;
      }

      throw caught;
    }
  };

  const archive = async (id: string): Promise<void> => {
    const index = conversations.value.findIndex((entry) => entry.id === id);
    const removed = conversations.value[index];

    // The list only shows active threads, so archiving removes it from view.
    conversations.value = conversations.value.filter((entry) => entry.id !== id);

    try {
      await conversationService.setStatus(id, 'archived');
    } catch (caught) {
      if (removed) {
        const restored = [...conversations.value];
        restored.splice(index, 0, removed);
        conversations.value = restored;
      }

      throw caught;
    }
  };

  const reset = (): void => {
    controller?.abort();
    conversations.value = [];
    page.value = 1;
    totalPages.value = 1;
    total.value = 0;
    search.value = '';
    error.value = null;
  };

  return {
    conversations,
    grouped,
    search,
    total,
    isLoading,
    isLoadingMore,
    isEmpty,
    hasMore,
    error,
    load,
    loadMore,
    setSearch,
    upsert,
    rename,
    remove,
    archive,
    reset,
  };
});
