import type { Conversation, Memory, Message } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toErrorMessage } from '@/services/api-error';
import { chatService, conversationService } from '@/services/chat.service';
import { useConversationsStore } from '@/stores/conversations';

const MESSAGE_PAGE_SIZE = 30;

/**
 * A turn that is on screen but not yet in the database.
 *
 * The person's own message appears the instant they press Enter — waiting for a
 * round trip to see your own words is the single thing that makes a chat feel
 * broken. It is marked pending so a failure can put it back in the composer
 * rather than leaving a message that looks sent and never was.
 */
export interface PendingMessage {
  id: string;
  content: string;
  createdAt: string;
}

/**
 * What the assistant is doing right now.
 *
 * Distinct from a generic spinner because these mean different things and take
 * different amounts of time: `thinking` is a model call, `working` is a tool
 * running. The backend does not stream tool events yet, so `working` is only
 * entered when the transcript comes back showing tools were used — the UI never
 * invents a step that did not happen.
 */
export type ChatPhase = 'idle' | 'thinking' | 'working';

/**
 * The open conversation.
 *
 * Messages live here rather than in the conversation-list store because they
 * belong to one screen and are large: keeping them separate means opening a
 * thread does not touch the sidebar, and the sidebar's pagination does not
 * re-render the transcript.
 *
 * The shape is chosen so streaming can be added without a rewrite. A reply is
 * appended as a whole message today; when the API streams, the same slot is
 * updated in place as text arrives and `phase` carries the tool events. Nothing
 * that reads this store would have to change.
 */
export const useChatStore = defineStore('chat', () => {
  const conversationId = ref<string | null>(null);
  const conversation = ref<Conversation | null>(null);
  const messages = ref<Message[]>([]);
  const pending = ref<PendingMessage | null>(null);
  const pendingMemories = ref<Memory[]>([]);

  const phase = ref<ChatPhase>('idle');
  const isLoadingMessages = ref(false);
  const isLoadingOlder = ref(false);
  const error = ref<string | null>(null);
  /** Kept so a failed turn can be retried without retyping it. */
  const lastFailedMessage = ref<string | null>(null);

  const messagePage = ref(1);
  const messageTotalPages = ref(1);

  let controller: AbortController | null = null;

  const isSending = computed(() => phase.value !== 'idle');
  const isEmpty = computed(() => messages.value.length === 0 && pending.value === null);
  const hasOlderMessages = computed(() => messagePage.value < messageTotalPages.value);

  /**
   * Only the turns worth showing.
   *
   * The transcript stores what the *model* saw, which includes a `tool` message
   * per result — the raw text handed back to it. Those are already rendered as
   * part of the assistant turn that asked for them, so showing them again would
   * duplicate every result as an unattributed wall of text.
   */
  const visibleMessages = computed(() =>
    messages.value.filter((message) => message.role === 'user' || message.role === 'assistant'),
  );

  const reset = (): void => {
    controller?.abort();
    conversationId.value = null;
    conversation.value = null;
    messages.value = [];
    pending.value = null;
    pendingMemories.value = [];
    phase.value = 'idle';
    error.value = null;
    lastFailedMessage.value = null;
    messagePage.value = 1;
    messageTotalPages.value = 1;
  };

  /** Starts a fresh thread. Nothing is created server-side until a first turn. */
  const startNew = (): void => {
    reset();
  };

  const fetchMessages = async (id: string, page: number): Promise<Message[]> => {
    controller?.abort();
    controller = new AbortController();

    const result = await conversationService.messages(
      id,
      { page, pageSize: MESSAGE_PAGE_SIZE },
      { signal: controller.signal },
    );

    messagePage.value = result.pagination.page;
    messageTotalPages.value = result.pagination.totalPages;

    // The API returns newest-first; a transcript reads oldest-first.
    return [...result.items].reverse();
  };

  const open = async (id: string): Promise<void> => {
    if (conversationId.value === id && messages.value.length > 0) {
      return;
    }

    reset();
    conversationId.value = id;
    isLoadingMessages.value = true;

    try {
      const [record, page] = await Promise.all([
        conversationService.get(id),
        fetchMessages(id, 1),
      ]);

      conversation.value = record;
      messages.value = page;
      error.value = null;
    } catch (caught) {
      if ((caught as { code?: string }).code === 'CANCELLED') {
        return;
      }

      error.value = toErrorMessage(caught);
      messages.value = [];
    } finally {
      isLoadingMessages.value = false;
    }
  };

  /** Pulls the previous page and prepends it, keeping the reading order. */
  const loadOlder = async (): Promise<void> => {
    const id = conversationId.value;

    if (!id || !hasOlderMessages.value || isLoadingOlder.value) {
      return;
    }

    isLoadingOlder.value = true;

    try {
      const older = await fetchMessages(id, messagePage.value + 1);
      messages.value = [...older, ...messages.value];
    } catch (caught) {
      if ((caught as { code?: string }).code !== 'CANCELLED') {
        error.value = toErrorMessage(caught);
      }
    } finally {
      isLoadingOlder.value = false;
    }
  };

  /**
   * Sends a turn.
   *
   * The reply that comes back is the assistant's *final* message; the tool calls
   * happened on intermediate turns that are already in the transcript. So the
   * page is re-read rather than the reply appended — that is what makes the
   * tool cards real rather than reconstructed, and it is the honest way to show
   * work the client did not witness.
   */
  const send = async (text: string): Promise<void> => {
    const content = text.trim();

    if (content.length === 0 || isSending.value) {
      return;
    }

    const conversations = useConversationsStore();

    pending.value = {
      id: `pending-${Date.now()}`,
      content,
      createdAt: new Date().toISOString(),
    };
    phase.value = 'thinking';
    error.value = null;
    lastFailedMessage.value = null;

    try {
      const response = await chatService.send(content, conversationId.value ?? undefined);
      const isNewThread = conversationId.value !== response.conversationId;

      conversationId.value = response.conversationId;
      pendingMemories.value = response.pendingMemories as unknown as Memory[];

      // Tools ran on turns the client never saw; re-reading is what surfaces
      // them, and it is also what keeps ids and timestamps the server's.
      phase.value = 'working';
      messages.value = await fetchMessages(response.conversationId, 1);
      pending.value = null;

      const record = await conversationService.get(response.conversationId);
      conversation.value = record;
      conversations.upsert(record);

      if (isNewThread) {
        // A new thread was titled server-side from this first message.
        void conversations.load();
      }
    } catch (caught) {
      // The words go back to the composer rather than being lost, and the
      // bubble is withdrawn so nothing looks delivered that was not.
      lastFailedMessage.value = content;
      pending.value = null;
      error.value = toErrorMessage(caught);
    } finally {
      phase.value = 'idle';
    }
  };

  /** Re-sends the last turn that failed. */
  const retry = async (): Promise<void> => {
    const text = lastFailedMessage.value;

    if (!text) {
      return;
    }

    lastFailedMessage.value = null;
    await send(text);
  };

  /**
   * Asks the assistant to answer again.
   *
   * There is no regenerate endpoint, and inventing one is not the frontend's
   * call — so this re-sends the last thing the person said, which is what a
   * regenerate *is* to a stateless chat API. The earlier answer stays in the
   * transcript, because it is a real turn that really happened.
   */
  const regenerate = async (): Promise<void> => {
    const lastUserMessage = [...visibleMessages.value]
      .reverse()
      .find((message) => message.role === 'user');

    if (!lastUserMessage || isSending.value) {
      return;
    }

    await send(lastUserMessage.content);
  };

  const dismissPendingMemory = (id: string): void => {
    pendingMemories.value = pendingMemories.value.filter((memory) => memory.id !== id);
  };

  return {
    conversationId,
    conversation,
    messages,
    visibleMessages,
    pending,
    pendingMemories,
    phase,
    isSending,
    isEmpty,
    isLoadingMessages,
    isLoadingOlder,
    hasOlderMessages,
    error,
    lastFailedMessage,
    open,
    startNew,
    loadOlder,
    send,
    retry,
    regenerate,
    dismissPendingMemory,
    reset,
  };
});
