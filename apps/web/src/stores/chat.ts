import type { ChatResponse, Conversation, Message, MessageToolCall } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

import { toChatError, EMPTY_ANSWER } from '@/chat/chat-errors';
import { chatService } from '@/services/chat.service';
import { isCancelled } from '@/services/api-error';
import { conversationService } from '@/services/conversation.service';
import { memoryService } from '@/services/memory.service';
import { useConversationsStore } from '@/stores/conversations';

const MESSAGE_PAGE_SIZE = 30;

/** What the chat response carries about a memory: enough to show, not the row. */
export type MemorySummary = ChatResponse['pendingMemories'][number];

/**
 * A turn that is on screen but not yet in the database.
 *
 * The person's own message appears the instant they press Enter — waiting for a
 * round trip to see your own words is the single thing that makes a chat feel
 * broken. It is held separately from the transcript so a failure can put it
 * back in the composer rather than leaving a bubble that looks delivered and
 * never was.
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
 * different amounts of time: `thinking` is a model call, `working` is the reply
 * being reconciled with the transcript.
 *
 * There is deliberately no phase that claims a *particular* tool is running.
 * The API answers once, at the end, so the client does not know which tool is
 * in flight — and inventing "Billz ma'lumotlari olinmoqda…" on a guess would be
 * a lie the interface tells about work it cannot see. Real tool steps are
 * rendered from the transcript, where they actually happened, and the seam
 * below is what a future stream would drive instead.
 */
export type ChatPhase = 'idle' | 'thinking' | 'working';

/**
 * One event of an assistant turn as it happens.
 *
 * Nothing emits these yet: the current API returns a finished reply. They exist
 * because the shape of the store is the thing that would otherwise have to be
 * rewritten when streaming arrives — text arriving in pieces and tools starting
 * and finishing are exactly the two updates a transcript cannot express if
 * messages are only ever appended whole. `applyStreamEvent` is the single entry
 * point for them, so adding a transport later is a service change, not a
 * redesign of the chat.
 */
export type ChatStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-started'; call: Pick<MessageToolCall, 'callId' | 'name'> }
  | { type: 'tool-finished'; call: MessageToolCall };

/**
 * The open conversation.
 *
 * Messages live here rather than in the conversation-list store because they
 * belong to one screen and are large: opening a thread does not touch the
 * sidebar, and the sidebar's pagination does not re-render the transcript.
 */
export const useChatStore = defineStore('chat', () => {
  const conversationId = ref<string | null>(null);
  const conversation = ref<Conversation | null>(null);
  const messages = ref<Message[]>([]);
  const pending = ref<PendingMessage | null>(null);

  /** Memories the assistant wants to keep and is waiting to be allowed to. */
  const pendingMemories = ref<MemorySummary[]>([]);
  /** Memories that were in the prompt for the last answer. */
  const usedMemories = ref<MemorySummary[]>([]);

  /** Assistant text as it arrives; empty unless a stream is driving it. */
  const streamingText = ref('');
  /** Tools currently running, as reported by a stream. Empty otherwise. */
  const runningTools = ref<Array<Pick<MessageToolCall, 'callId' | 'name'>>>([]);

  const phase = ref<ChatPhase>('idle');
  const isLoadingMessages = ref(false);
  const isLoadingOlder = ref(false);
  const error = ref<string | null>(null);
  /** Whether the failure above is worth offering a retry for. */
  const canRetry = ref(false);
  /** Kept so a failed turn can be retried without retyping it. */
  const lastFailedMessage = ref<string | null>(null);

  const messagePage = ref(1);
  const messageTotalPages = ref(1);

  let controller: AbortController | null = null;

  const isSending = computed(() => phase.value !== 'idle');
  const hasOlderMessages = computed(() => messagePage.value < messageTotalPages.value);

  /**
   * Only the turns worth showing.
   *
   * The transcript stores what the *model* saw, which includes a `tool` message
   * per result — the raw text handed back to it. Those are already rendered as
   * part of the assistant turn that asked for them, so showing them again would
   * repeat every result as an unattributed wall of text.
   */
  const visibleMessages = computed(() =>
    messages.value.filter((message) => message.role === 'user' || message.role === 'assistant'),
  );

  const isEmpty = computed(
    () => visibleMessages.value.length === 0 && pending.value === null && !isSending.value,
  );

  const reset = (): void => {
    controller?.abort();
    controller = null;
    conversationId.value = null;
    conversation.value = null;
    messages.value = [];
    pending.value = null;
    pendingMemories.value = [];
    usedMemories.value = [];
    streamingText.value = '';
    runningTools.value = [];
    phase.value = 'idle';
    error.value = null;
    canRetry.value = false;
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

    messagePage.value = Math.max(messagePage.value, result.pagination.page);
    messageTotalPages.value = result.pagination.totalPages;

    return result.items;
  };

  /**
   * Folds a freshly read page into what is already on screen.
   *
   * Re-reading page one after a turn would otherwise throw away the older pages
   * somebody had just scrolled up to load. Ids win over position: the server's
   * copy of a message replaces the local one, and order is by creation time so
   * a merged transcript still reads top to bottom.
   */
  const mergeMessages = (incoming: Message[]): void => {
    const byId = new Map(messages.value.map((message) => [message.id, message]));

    for (const message of incoming) {
      byId.set(message.id, message);
    }

    messages.value = [...byId.values()].sort((left, right) =>
      left.createdAt === right.createdAt
        ? left.id.localeCompare(right.id)
        : left.createdAt.localeCompare(right.createdAt),
    );
  };

  const open = async (id: string): Promise<void> => {
    if (conversationId.value === id && messages.value.length > 0) {
      return;
    }

    reset();
    conversationId.value = id;
    isLoadingMessages.value = true;

    try {
      const [record, page] = await Promise.all([conversationService.get(id), fetchMessages(id, 1)]);

      conversation.value = record;
      messages.value = page;
      error.value = null;
    } catch (caught) {
      if (isCancelled(caught)) {
        return;
      }

      error.value = toChatError(caught).message;
      canRetry.value = false;
      messages.value = [];
    } finally {
      isLoadingMessages.value = false;
    }
  };

  /** Pulls the previous page and folds it in, keeping the reading order. */
  const loadOlder = async (): Promise<void> => {
    const id = conversationId.value;

    if (!id || !hasOlderMessages.value || isLoadingOlder.value) {
      return;
    }

    isLoadingOlder.value = true;

    try {
      mergeMessages(await fetchMessages(id, messagePage.value + 1));
    } catch (caught) {
      if (!isCancelled(caught)) {
        error.value = toChatError(caught).message;
        canRetry.value = false;
      }
    } finally {
      isLoadingOlder.value = false;
    }
  };

  /**
   * Sends a turn.
   *
   * The reply that comes back is the assistant's *final* message; any tools ran
   * on intermediate turns that are already stored. So the transcript is re-read
   * rather than the reply appended — that is what makes the tool cards real
   * rather than reconstructed, and it is the honest way to show work the client
   * did not witness.
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
    canRetry.value = false;
    lastFailedMessage.value = null;

    try {
      const response = await chatService.send(content, conversationId.value ?? undefined);
      const isNewThread = conversationId.value !== response.conversationId;

      conversationId.value = response.conversationId;
      pendingMemories.value = response.pendingMemories;
      usedMemories.value = response.usedMemories;

      // Tools ran on turns the client never saw; re-reading is what surfaces
      // them, and it is also what keeps ids and timestamps the server's.
      phase.value = 'working';
      streamingText.value = '';
      runningTools.value = [];

      const page = await fetchMessages(response.conversationId, 1);

      if (isNewThread) {
        messages.value = page;
      } else {
        mergeMessages(page);
      }

      pending.value = null;

      // A reply with no words and no tool steps is not an answer, and letting
      // it pass would leave an empty bubble nobody can act on.
      if (response.message.content.trim().length === 0 && response.message.toolCalls.length === 0) {
        lastFailedMessage.value = content;
        error.value = EMPTY_ANSWER.message;
        canRetry.value = EMPTY_ANSWER.retriable;
      }

      const record = await conversationService.get(response.conversationId);
      conversation.value = record;
      conversations.upsert(record);
    } catch (caught) {
      // The words go back to the composer rather than being lost, and the
      // bubble is withdrawn so nothing looks delivered that was not.
      const failure = toChatError(caught);

      lastFailedMessage.value = failure.retriable ? content : null;
      pending.value = null;
      error.value = failure.message;
      canRetry.value = failure.retriable;
    } finally {
      phase.value = 'idle';
    }
  };

  /** Clears a failure the person has read and cannot retry. */
  const dismissError = (): void => {
    error.value = null;
    canRetry.value = false;
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
   * transcript, because it is a turn that really happened.
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

  /**
   * The one place a live update enters the transcript.
   *
   * Unused until the API streams; wired now so that adding a transport touches
   * a service and this function, and nothing that renders.
   */
  const applyStreamEvent = (event: ChatStreamEvent): void => {
    if (event.type === 'text') {
      streamingText.value += event.delta;

      return;
    }

    if (event.type === 'tool-started') {
      runningTools.value = [...runningTools.value, event.call];

      return;
    }

    runningTools.value = runningTools.value.filter((call) => call.callId !== event.call.callId);
  };

  /** Keeps what the assistant asked to remember. */
  const confirmMemory = async (id: string): Promise<void> => {
    await memoryService.confirm(id);
    pendingMemories.value = pendingMemories.value.filter((memory) => memory.id !== id);
  };

  /** Refuses it, and tells the server to drop it rather than only hiding it. */
  const forgetMemory = async (id: string): Promise<void> => {
    await memoryService.forget(id);
    pendingMemories.value = pendingMemories.value.filter((memory) => memory.id !== id);
  };

  /** Reflects a rename made through the sidebar without a re-read. */
  const applyConversation = (record: Conversation): void => {
    if (conversation.value?.id === record.id) {
      conversation.value = record;
    }
  };

  return {
    conversationId,
    conversation,
    messages,
    visibleMessages,
    pending,
    pendingMemories,
    usedMemories,
    streamingText,
    runningTools,
    phase,
    isSending,
    isEmpty,
    isLoadingMessages,
    isLoadingOlder,
    hasOlderMessages,
    error,
    canRetry,
    lastFailedMessage,
    open,
    startNew,
    loadOlder,
    send,
    retry,
    dismissError,
    regenerate,
    applyStreamEvent,
    confirmMemory,
    forgetMemory,
    applyConversation,
    reset,
  };
});
