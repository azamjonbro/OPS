import type { Conversation, ConversationStatus, Message } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import { conversationService } from '@/services/conversation.service';

/**
 * Chat state for the UI.
 *
 * It holds the thread list, the open thread and its messages, and the two flags
 * every screen needs: whether something is in flight and what went wrong. The
 * final chat interface is a later phase; this is the state it will bind to.
 *
 * Sending is tracked separately from loading, because typing a new message must
 * not blank the transcript that is already on screen.
 */
export const useConversationsStore = defineStore('conversations', () => {
  const conversations = ref<Conversation[]>([]);
  const activeConversationId = ref<string | null>(null);
  const messages = ref<Message[]>([]);

  const isLoadingConversations = ref(false);
  const isLoadingMessages = ref(false);
  const isSending = ref(false);
  const error = ref<string | null>(null);

  const activeConversation = computed(
    () => conversations.value.find((entry) => entry.id === activeConversationId.value) ?? null,
  );

  const hasConversations = computed(() => conversations.value.length > 0);

  const run = async <TResult>(
    flag: { value: boolean },
    action: () => Promise<TResult>,
  ): Promise<TResult | null> => {
    flag.value = true;
    error.value = null;

    try {
      return await action();
    } catch (caught) {
      error.value = toErrorMessage(caught);

      return null;
    } finally {
      flag.value = false;
    }
  };

  const loadConversations = async (status: ConversationStatus = 'active'): Promise<void> => {
    const result = await run(isLoadingConversations, () => conversationService.list({ status }));

    if (result) {
      conversations.value = result.items;
    }
  };

  const loadMessages = async (conversationId: string): Promise<void> => {
    activeConversationId.value = conversationId;

    const result = await run(isLoadingMessages, () => conversationService.messages(conversationId));

    if (result) {
      messages.value = result.items;
    }
  };

  const openConversation = async (title?: string): Promise<Conversation | null> => {
    const created = await run(isLoadingConversations, () => conversationService.create(title));

    if (created) {
      conversations.value = [created, ...conversations.value];
      activeConversationId.value = created.id;
      messages.value = [];
    }

    return created;
  };

  /**
   * Sends a turn and folds the reply into the open thread.
   *
   * The message is appended only once the server confirms it, so the transcript
   * never shows a turn that was not stored.
   */
  const sendMessage = async (text: string): Promise<void> => {
    const trimmed = text.trim();

    if (trimmed.length === 0 || isSending.value) {
      return;
    }

    const response = await run(isSending, () =>
      conversationService.chat(trimmed, activeConversationId.value ?? undefined),
    );

    if (!response) {
      return;
    }

    const isNewThread = activeConversationId.value !== response.conversationId;
    activeConversationId.value = response.conversationId;

    if (isNewThread) {
      // A new thread was opened server-side; pull the list so it appears with
      // the title the API derived from this first message.
      await loadConversations();
      await loadMessages(response.conversationId);
      return;
    }

    await loadMessages(response.conversationId);
  };

  const archiveConversation = async (conversationId: string): Promise<void> => {
    const updated = await run(isLoadingConversations, () =>
      conversationService.setStatus(conversationId, 'archived'),
    );

    if (updated) {
      conversations.value = conversations.value.filter((entry) => entry.id !== conversationId);

      if (activeConversationId.value === conversationId) {
        activeConversationId.value = null;
        messages.value = [];
      }
    }
  };

  const deleteConversation = async (conversationId: string): Promise<void> => {
    const done = await run(isLoadingConversations, async () => {
      await conversationService.remove(conversationId);

      return true;
    });

    if (done) {
      conversations.value = conversations.value.filter((entry) => entry.id !== conversationId);

      if (activeConversationId.value === conversationId) {
        activeConversationId.value = null;
        messages.value = [];
      }
    }
  };

  const reset = (): void => {
    conversations.value = [];
    messages.value = [];
    activeConversationId.value = null;
    error.value = null;
  };

  return {
    conversations,
    messages,
    activeConversationId,
    activeConversation,
    hasConversations,
    isLoadingConversations,
    isLoadingMessages,
    isSending,
    error,
    loadConversations,
    loadMessages,
    openConversation,
    sendMessage,
    archiveConversation,
    deleteConversation,
    reset,
  };
});
