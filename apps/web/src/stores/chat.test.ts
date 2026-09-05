import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import * as agentStream from '@/services/agent-stream';
import { ApiClientError } from '@/services/api-error';
import { chatService } from '@/services/chat.service';
import { conversationService } from '@/services/conversation.service';
import { memoryService } from '@/services/memory.service';
import { useChatStore } from '@/stores/chat';
import { useConversationsStore } from '@/stores/conversations';
import {
  makeAgentEvent,
  makeChatResponse,
  makeConversation,
  makeMemory,
  makeMessage,
  makeToolEvent,
  paginated,
  resetAgentEventSequence,
} from '@/test/factories';

/**
 * The chat store against a mocked API.
 *
 * Nothing here reaches a server, an AI provider, Billz or Notion: the tests own
 * every response, which is what lets them assert on the awkward cases — a
 * provider outage, an empty answer, a thread opened while another is still
 * loading — without a running backend or a paid model call.
 */
beforeEach(() => {
  setActivePinia(createPinia());

  // A turn is streamed now. The stub delivers the run through whatever
  // `chatService.send` a test has mocked, so every assertion below is still
  // about the store's behaviour rather than about a socket.
  vi.spyOn(agentStream, 'streamChat').mockImplementation(async (input, handlers) => {
    handlers.onReady?.({ runId: 'run-1', conversationId: input.conversationId ?? '' });

    try {
      handlers.onResult(await chatService.send(input.message, input.conversationId));
    } catch (caught) {
      handlers.onFailure(caught as ApiClientError);
    }
  });
});

const stubConversationReads = (conversation = makeConversation(), messages = [makeMessage()]) => {
  vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
  vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated(messages));

  return conversation;
};

describe('opening a conversation', () => {
  it('loads the record and its messages from the API', async () => {
    const conversation = makeConversation({ title: 'Bugungi savdo' });
    const messages = [
      makeMessage({ role: 'user', content: 'Bugungi savdoni tahlil qil' }),
      makeMessage({ role: 'assistant', content: '12 ta savdo' }),
    ];
    stubConversationReads(conversation, messages);

    const chat = useChatStore();
    await chat.open(conversation.id);

    expect(conversationService.get).toHaveBeenCalledWith(conversation.id);
    expect(chat.conversation?.title).toBe('Bugungi savdo');
    expect(chat.visibleMessages).toHaveLength(2);
  });

  it('hides the tool turns the model saw but a reader should not', async () => {
    const conversation = makeConversation();
    stubConversationReads(conversation, [
      makeMessage({ role: 'user', content: 'Savdo?' }),
      makeMessage({ role: 'tool', content: '{"saleCount":12}', toolCallId: 'call-1' }),
      makeMessage({ role: 'assistant', content: '12 ta savdo' }),
    ]);

    const chat = useChatStore();
    await chat.open(conversation.id);

    expect(chat.messages).toHaveLength(3);
    expect(chat.visibleMessages.map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('reports a thread that is not the signed-in employee’s as missing', async () => {
    vi.spyOn(conversationService, 'get').mockRejectedValue(
      new ApiClientError('Conversation not found', { code: 'NOT_FOUND', status: 404 }),
    );
    vi.spyOn(conversationService, 'messages').mockRejectedValue(
      new ApiClientError('Conversation not found', { code: 'NOT_FOUND', status: 404 }),
    );

    const chat = useChatStore();
    await chat.open('a'.repeat(24));

    expect(chat.error).toBe('This conversation no longer exists.');
    // Not retriable: sending the same turn again would fail the same way.
    expect(chat.canRetry).toBe(false);
    expect(chat.messages).toEqual([]);
  });
});

describe('message pagination', () => {
  it('asks for the next page and keeps what was already read', async () => {
    const conversation = makeConversation();
    const newest = makeMessage({ role: 'assistant', createdAt: '2026-09-05T10:00:00.000Z' });
    const older = makeMessage({ role: 'user', createdAt: '2026-09-04T10:00:00.000Z' });

    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    const messages = vi
      .spyOn(conversationService, 'messages')
      .mockResolvedValueOnce(paginated([newest], { page: 1, pageSize: 30, total: 31 }))
      .mockResolvedValueOnce(paginated([older], { page: 2, pageSize: 30, total: 31 }));

    const chat = useChatStore();
    await chat.open(conversation.id);

    expect(chat.hasOlderMessages).toBe(true);

    await chat.loadOlder();

    expect(messages).toHaveBeenLastCalledWith(
      conversation.id,
      { page: 2, pageSize: 30 },
      expect.anything(),
    );
    // Prepended, not replaced, and still in reading order.
    expect(chat.messages.map((message) => message.id)).toEqual([older.id, newest.id]);
  });
});

describe('sending a message', () => {
  it('shows the turn immediately and re-reads the transcript for the reply', async () => {
    const conversation = makeConversation();
    const reply = makeMessage({ role: 'assistant', content: 'Bugun 12 ta savdo.' });

    vi.spyOn(chatService, 'send').mockResolvedValue(
      makeChatResponse({ conversationId: conversation.id, message: reply }),
    );
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(
      paginated([makeMessage({ role: 'user', content: 'Savdo?' }), reply]),
    );

    const chat = useChatStore();
    const inFlight = chat.send('Savdo?');

    // The person's own words appear before the round trip finishes.
    expect(chat.pending?.content).toBe('Savdo?');
    expect(chat.isSending).toBe(true);

    await inFlight;

    expect(chatService.send).toHaveBeenCalledWith('Savdo?', undefined);
    expect(chat.pending).toBeNull();
    expect(chat.conversationId).toBe(conversation.id);
    expect(chat.visibleMessages.at(-1)?.content).toBe('Bugun 12 ta savdo.');
  });

  it('sends the conversation id on every turn after the first', async () => {
    const conversation = stubConversationReads();
    vi.spyOn(chatService, 'send').mockResolvedValue(
      makeChatResponse({ conversationId: conversation.id }),
    );

    const chat = useChatStore();
    await chat.open(conversation.id);
    await chat.send('Yana');

    expect(chatService.send).toHaveBeenCalledWith('Yana', conversation.id);
  });

  it('refuses to send an empty turn', async () => {
    const send = vi.spyOn(chatService, 'send');
    const chat = useChatStore();

    await chat.send('   ');

    expect(send).not.toHaveBeenCalled();
  });

  it('puts a new thread at the top of the sidebar', async () => {
    const conversation = makeConversation();
    vi.spyOn(chatService, 'send').mockResolvedValue(
      makeChatResponse({ conversationId: conversation.id }),
    );
    vi.spyOn(conversationService, 'get').mockResolvedValue(conversation);
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));

    const conversations = useConversationsStore();
    const chat = useChatStore();
    await chat.send('Salom');

    expect(conversations.conversations[0]?.id).toBe(conversation.id);
  });
});

describe('when a turn fails', () => {
  it('names an exhausted account instead of telling the person to wait', async () => {
    vi.spyOn(chatService, 'send').mockRejectedValue(
      new ApiClientError('The AI account has run out of credit.', {
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
        // The API classifies the failure more precisely than its status can.
        details: { integration: 'ai', kind: 'quota_exhausted' },
      }),
    );

    const chat = useChatStore();
    await chat.send('Savdo?');

    // "Not responding, try again in a moment" would be advice that is just as
    // wrong tomorrow: the balance is empty, not busy.
    expect(chat.error).toBe(
      'The AI account has run out of credit. Top it up to keep using Hadiya.',
    );
    expect(chat.error).not.toContain('try again');
    // And no retry is offered, because retrying cannot work.
    expect(chat.canRetry).toBe(false);
  });

  it('explains an unavailable AI provider without leaking the server’s wording', async () => {
    vi.spyOn(chatService, 'send').mockRejectedValue(
      new ApiClientError('anthropic rejected key sk-ant-123', {
        code: 'DEPENDENCY_UNAVAILABLE',
        status: 503,
      }),
    );

    const chat = useChatStore();
    await chat.send('Savdo?');

    expect(chat.error).toBe(
      'The AI service is not responding right now. Please try again in a moment.',
    );
    expect(chat.error).not.toContain('sk-ant');
    expect(chat.canRetry).toBe(true);
    // The bubble is withdrawn: nothing should look delivered that was not.
    expect(chat.pending).toBeNull();
  });

  it('explains a dropped connection', async () => {
    vi.spyOn(chatService, 'send').mockRejectedValue(
      new ApiClientError('Could not reach the server.', { code: 'NETWORK_ERROR' }),
    );

    const chat = useChatStore();
    await chat.send('Savdo?');

    expect(chat.error).toBe('Could not reach Hadiya. Check your connection and try again.');
  });

  it('keeps the words so a retry does not need them typed again', async () => {
    const send = vi
      .spyOn(chatService, 'send')
      .mockRejectedValueOnce(new ApiClientError('offline', { code: 'NETWORK_ERROR' }))
      .mockResolvedValue(makeChatResponse());
    vi.spyOn(conversationService, 'get').mockResolvedValue(makeConversation());
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));

    const chat = useChatStore();
    await chat.send('Bugungi savdoni tahlil qil');

    expect(chat.lastFailedMessage).toBe('Bugungi savdoni tahlil qil');

    await chat.retry();

    expect(send).toHaveBeenLastCalledWith('Bugungi savdoni tahlil qil', undefined);
    expect(chat.error).toBeNull();
  });

  it('does not offer a retry when the session has expired', async () => {
    vi.spyOn(chatService, 'send').mockRejectedValue(
      new ApiClientError('jwt expired', { code: 'UNAUTHENTICATED', status: 401 }),
    );

    const chat = useChatStore();
    await chat.send('Savdo?');

    expect(chat.error).toBe(
      'Your session has expired. Sign in again to continue the conversation.',
    );
    expect(chat.canRetry).toBe(false);
    expect(chat.lastFailedMessage).toBeNull();
  });

  it('treats an answer with no words and no steps as a failure', async () => {
    const empty = makeMessage({ role: 'assistant', content: '', toolCalls: [] });
    vi.spyOn(chatService, 'send').mockResolvedValue(makeChatResponse({ message: empty }));
    vi.spyOn(conversationService, 'get').mockResolvedValue(makeConversation());
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([empty]));

    const chat = useChatStore();
    await chat.send('Savdo?');

    expect(chat.error).toBe('Hadiya did not return an answer. Please try again.');
    expect(chat.canRetry).toBe(true);
  });
});

describe('memory', () => {
  it('surfaces what the assistant asked to remember', async () => {
    const memory = makeMemory({ key: 'content_language', value: 'uzbek' });
    vi.spyOn(chatService, 'send').mockResolvedValue(
      makeChatResponse({
        pendingMemories: [
          { id: memory.id, type: memory.type, key: memory.key, value: memory.value },
        ],
      }),
    );
    vi.spyOn(conversationService, 'get').mockResolvedValue(makeConversation());
    vi.spyOn(conversationService, 'messages').mockResolvedValue(paginated([makeMessage()]));

    const chat = useChatStore();
    await chat.send('Men bilan o‘zbekcha gaplash');

    expect(chat.pendingMemories).toHaveLength(1);

    vi.spyOn(memoryService, 'confirm').mockResolvedValue(memory);
    await chat.confirmMemory(memory.id);

    // The decision is stored server-side, not merely hidden here.
    expect(memoryService.confirm).toHaveBeenCalledWith(memory.id);
    expect(chat.pendingMemories).toHaveLength(0);
  });
});

describe('watching a run', () => {
  it('folds the server’s events into a timeline', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    chat.applyStreamEvent(makeAgentEvent('agent.started', { tools: 12 }));
    chat.applyStreamEvent(makeToolEvent('tool.started', { attempt: 1 }));

    expect(chat.run.state).toBe('running');
    expect(chat.run.steps).toHaveLength(1);
    expect(chat.run.steps[0]).toMatchObject({
      status: 'running',
      displayName: 'Sales figures',
      integration: 'Billz',
    });

    chat.applyStreamEvent(makeToolEvent('tool.completed', { durationMs: 120, attempts: 1 }));

    // The same call id updates the step it belongs to rather than adding a
    // second row beside it.
    expect(chat.run.steps).toHaveLength(1);
    expect(chat.run.steps[0]?.status).toBe('completed');

    chat.applyStreamEvent(makeAgentEvent('agent.completed', { state: 'completed' }));
    expect(chat.run.state).toBe('completed');
  });

  it('accumulates the answer as it is written', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    chat.applyStreamEvent(makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: 'Bugun ' }));
    chat.applyStreamEvent(
      makeAgentEvent('assistant.delta', { messageId: 'm-1', delta: '12 ta savdo' }),
    );

    expect(chat.run.streamingText).toBe('Bugun 12 ta savdo');
  });

  it('ignores an event it has already applied', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    const started = makeToolEvent('tool.started');
    chat.applyStreamEvent(started);
    // Exactly what a reconnection would deliver if the server replayed too far.
    chat.applyStreamEvent(started);

    expect(chat.run.steps).toHaveLength(1);
  });

  it('shows a failed step as failed, in the server’s words', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    chat.applyStreamEvent(makeToolEvent('tool.started'));
    chat.applyStreamEvent(
      makeToolEvent('tool.failed', { attempts: 1, message: 'Notion is unreachable' }),
    );

    expect(chat.run.steps[0]).toMatchObject({
      status: 'failed',
      message: 'Notion is unreachable',
    });
    expect(chat.partialFailure).toContain('Sales figures');
  });

  it('holds a confirmation until it is answered', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    chat.applyStreamEvent(
      makeAgentEvent('confirmation.required', {
        callId: 'call-1',
        pendingActionId: 'pa-1',
        tool: 'crm_invoice',
        displayName: 'Invoice',
        title: 'Invoice',
        description: 'create an invoice for 1 200 000 UZS',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        integration: 'My CRM',
      }),
    );

    expect(chat.run.state).toBe('waiting_confirmation');
    expect(chat.confirmation).toMatchObject({ pendingActionId: 'pa-1', title: 'Invoice' });
    expect(chat.isConfirmationExpired).toBe(false);
  });

  it('treats a lapsed confirmation as no longer answerable', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    chat.applyStreamEvent(
      makeAgentEvent('confirmation.required', {
        callId: 'call-1',
        pendingActionId: 'pa-1',
        tool: 'crm_invoice',
        title: 'Invoice',
        description: 'create an invoice',
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );

    expect(chat.isConfirmationExpired).toBe(true);
  });

  it('stops presenting the run as active once it is cancelled', () => {
    resetAgentEventSequence();
    const chat = useChatStore();

    chat.applyStreamEvent(makeAgentEvent('agent.started', {}));
    expect(chat.isRunning).toBe(true);

    chat.applyStreamEvent(makeAgentEvent('agent.cancelled', {}));

    expect(chat.run.state).toBe('cancelled');
    expect(chat.isRunning).toBe(false);
  });
});

describe('cancelling a run', () => {
  it('asks the server once, however many times the button is pressed', async () => {
    resetAgentEventSequence();
    const conversation = stubConversationReads();
    const cancel = vi.spyOn(chatService, 'cancel').mockResolvedValue({
      conversationId: conversation.id,
      cancelledRuns: 1,
      cancelledActions: 0,
    });

    const chat = useChatStore();
    await chat.open(conversation.id);
    chat.applyStreamEvent(makeAgentEvent('agent.started', {}));

    await Promise.all([chat.cancel(), chat.cancel()]);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(chat.isCancelling).toBe(true);
  });

  it('does nothing when there is no run to stop', async () => {
    const conversation = stubConversationReads();
    const cancel = vi.spyOn(chatService, 'cancel');

    const chat = useChatStore();
    await chat.open(conversation.id);
    await chat.cancel();

    expect(cancel).not.toHaveBeenCalled();
  });
});

describe('starting a new chat', () => {
  it('clears the open thread without touching the server', async () => {
    const conversation = stubConversationReads();
    const chat = useChatStore();
    await chat.open(conversation.id);

    const create = vi.spyOn(conversationService, 'create');
    chat.startNew();

    expect(chat.conversationId).toBeNull();
    expect(chat.messages).toEqual([]);
    // A conversation is created by the first turn, not by pressing "New chat".
    expect(create).not.toHaveBeenCalled();
  });
});
