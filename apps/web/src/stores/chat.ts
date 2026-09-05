import type { AgentEvent, ChatResponse, Conversation, Message } from '@hadiya/shared';
import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';

import {
  applyAgentEvent,
  emptyRun,
  failureSummary,
  isConfirmationLive,
  isRunActive,
  type AgentRun,
} from '@/chat/agent-run';
import { toChatError, EMPTY_ANSWER } from '@/chat/chat-errors';
import { streamChat, watchRun, StreamUnavailableError } from '@/services/agent-stream';
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
 * What a *particular* tool is doing is not held here and never guessed: it
 * comes from `run`, below, which is folded from the events the server actually
 * emitted. Inventing "Billz ma'lumotlari olinmoqda…" on a hunch would be a lie
 * the interface tells about work it cannot see, and the whole point of the
 * stream is that it no longer has to.
 */
export type ChatPhase = 'idle' | 'thinking' | 'working';


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

  /**
   * The turn being watched, folded from the server's own events.
   *
   * Reactive and mutated in place rather than replaced: a streamed answer
   * arrives a few characters at a time, and handing Vue a new object for each
   * delta would redraw a timeline that has not changed.
   */
  const run = reactive<AgentRun>(emptyRun());

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
  /** Aborts the stream this browser is reading. Not a cancellation of the run. */
  let streamController: AbortController | null = null;
  /** True once a cancel has been asked for, so it cannot be asked for twice. */
  const isCancelling = ref(false);

  /**
   * The answer as it is painted, which is not quite the answer as it arrives.
   *
   * `run.streamingText` is the authoritative accumulation and is written for
   * every delta; this is the copy the transcript renders, and it is refreshed
   * once per animation frame. Tokens arrive faster than a screen updates, so
   * binding directly to the accumulation would schedule a render per token and
   * redraw the same paragraph dozens of times a second for no visible gain.
   *
   * Nothing is lost by the throttle: the painted copy is only ever behind by
   * less than a frame, and it is brought level whenever the run settles.
   */
  const streamingText = ref('');
  let flushHandle: number | null = null;

  const cancelFlush = (): void => {
    if (flushHandle === null) {
      return;
    }

    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(flushHandle);
    } else {
      clearTimeout(flushHandle);
    }

    flushHandle = null;
  };

  const flushDeltas = (): void => {
    flushHandle = null;
    streamingText.value = run.streamingText;
  };

  const scheduleFlush = (): void => {
    if (flushHandle !== null) {
      return;
    }

    flushHandle =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(flushDeltas)
        : (setTimeout(flushDeltas, 16) as unknown as number);
  };

  const isSending = computed(() => phase.value !== 'idle');
  /** Whether Stop should be offered: a run is going and has not been stopped. */
  const isRunning = computed(() => isRunActive(run) && !isCancelling.value);
  /** The proposal on screen, or `null` once it has lapsed. */
  const confirmation = computed(() => run.confirmation);
  const isConfirmationExpired = computed(
    () => run.confirmation !== null && !isConfirmationLive(run.confirmation),
  );
  /** One honest line about a turn that partly failed. Null when it did not. */
  const partialFailure = computed(() => failureSummary(run));
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

  const resetRun = (): void => {
    cancelFlush();
    streamingText.value = '';
    Object.assign(run, emptyRun());
    isCancelling.value = false;
  };

  const reset = (): void => {
    controller?.abort();
    controller = null;
    streamController?.abort();
    streamController = null;
    resetRun();
    conversationId.value = null;
    conversation.value = null;
    messages.value = [];
    pending.value = null;
    pendingMemories.value = [];
    usedMemories.value = [];
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
  /**
   * The one place a live event enters the client.
   *
   * Everything on screen during a run comes through here, and everything here
   * came from the server. De-duplication happens inside `applyAgentEvent`, by
   * sequence, which is what makes a reconnection safe and what stops two tabs
   * disagreeing about a run they are both watching.
   */
  const applyStreamEvent = (event: AgentEvent): void => {
    applyAgentEvent(run, event);

    // Text is painted once a frame; everything else lands at once, because a
    // step changing state is a thing somebody is waiting to see.
    if (event.type === 'assistant.delta') {
      scheduleFlush();
    }
  };

  /**
   * Sends the turn and returns the finished reply.
   *
   * Streaming first, with the narrow fallback described on `send`.
   */
  const deliver = async (content: string): Promise<ChatResponse> => {
    streamController?.abort();
    streamController = new AbortController();

    let settled: ChatResponse | null = null;
    let failure: unknown = null;
    let established = false;

    await streamChat(
      { message: content, ...(conversationId.value ? { conversationId: conversationId.value } : {}) },
      {
        onReady: (info) => {
          established = true;
          run.runId = info.runId;
          run.state = 'running';
        },
        onEvent: (event) => {
          established = true;
          applyStreamEvent(event);
        },
        onResult: (response) => {
          settled = response;
        },
        onFailure: (error_) => {
          failure = error_;
        },
        onReconnecting: () => {
          run.reconnecting = true;
        },
      },
      { signal: streamController.signal },
    );

    run.reconnecting = false;
    cancelFlush();
    flushDeltas();

    if (settled) {
      return settled;
    }

    if (failure instanceof StreamUnavailableError && !established) {
      // The stream never opened, so the turn never started.
      return chatService.send(content, conversationId.value ?? undefined);
    }

    throw failure ?? new Error('The assistant did not answer.');
  };

  /**
   * Sends a turn, watching it if the connection allows.
   *
   * The stream is tried first because it is what the interface is built for.
   * It falls back to the ordinary request in exactly one case: the stream never
   * opened at all — a proxy that will not pass `text/event-stream`, a browser
   * without a readable body. Nothing reached the agent then, so sending it
   * again cannot duplicate anything. A stream that dropped *after* it started
   * is never re-sent; that turn is running, and asking for it twice would be
   * two content plans and two invoices.
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
    resetRun();

    try {
      const response = await deliver(content);
      const isNewThread = conversationId.value !== response.conversationId;

      conversationId.value = response.conversationId;
      pendingMemories.value = response.pendingMemories;
      usedMemories.value = response.usedMemories;

      // Tools ran on turns the client never saw; re-reading is what surfaces
      // them, and it is also what keeps ids and timestamps the server's.
      phase.value = 'working';
      // The transcript is about to carry the finished answer, so the partial
      // one stops being drawn rather than sitting underneath a duplicate.
      cancelFlush();
      run.streamingText = '';
      streamingText.value = '';

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
   * Stops the run this conversation has going.
   *
   * The server is what actually stops it: this asks, and the run's own
   * `agent.cancelled` event is what turns the interface off. Guarded so a
   * second press cannot send a second request — cancelling twice is harmless
   * server-side and confusing on screen.
   *
   * The stream is left open on purpose. The cancelled run still has something
   * to say — which steps had finished, and the closing turn in the transcript —
   * and hanging up early would throw that away.
   */
  const cancel = async (): Promise<void> => {
    const id = conversationId.value;

    if (!id || isCancelling.value || !isRunActive(run)) {
      return;
    }

    isCancelling.value = true;

    try {
      await chatService.cancel(id);
    } catch (caught) {
      isCancelling.value = false;

      if (!isCancelled(caught)) {
        error.value = toChatError(caught).message;
        canRetry.value = false;
      }
    }
  };

  /**
   * Picks a run back up after the page has been reloaded.
   *
   * The browser has the conversation from the URL and nothing else, so it asks
   * the server what is running there. Nothing is reconstructed from what this
   * tab remembers — it remembers nothing — and a run that has already finished
   * is not replayed as though it were live: the transcript already holds it.
   */
  const resumeActiveRun = async (id: string): Promise<void> => {
    let snapshot;

    try {
      ({ run: snapshot } = await chatService.activeRun(id));
    } catch {
      // Nothing to resume is the ordinary case, and never worth an error.
      return;
    }

    if (!snapshot?.active) {
      return;
    }

    resetRun();
    run.runId = snapshot.runId;
    run.state = 'running';
    phase.value = 'thinking';

    for (const event of snapshot.events) {
      applyStreamEvent(event);
    }

    flushDeltas();

    streamController?.abort();
    streamController = new AbortController();

    try {
      await watchRun(
        snapshot.runId,
        {
          onEvent: applyStreamEvent,
          onResult: (response) => {
            pendingMemories.value = response.pendingMemories;
            usedMemories.value = response.usedMemories;
            void refreshTranscript(response.conversationId);
          },
          onFailure: (caught) => {
            error.value = toChatError(caught).message;
          },
          onReconnecting: () => {
            run.reconnecting = true;
          },
        },
        { signal: streamController.signal, afterSequence: run.lastSequence },
      );
    } finally {
      run.reconnecting = false;
      phase.value = 'idle';
    }
  };

  /** Re-reads the thread so a resumed run ends on the server's own record. */
  const refreshTranscript = async (id: string): Promise<void> => {
    cancelFlush();
    run.streamingText = '';
    streamingText.value = '';

    try {
      mergeMessages(await fetchMessages(id, 1));
    } catch (caught) {
      if (!isCancelled(caught)) {
        error.value = toChatError(caught).message;
      }
    }
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
    run,
    streamingText,
    confirmation,
    isConfirmationExpired,
    isCancelling,
    isRunning,
    partialFailure,
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
    cancel,
    resumeActiveRun,
    applyStreamEvent,
    confirmMemory,
    forgetMemory,
    applyConversation,
    reset,
  };
});
