import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError } from '@/services/api-error';
import { chatService } from '@/services/chat.service';
import { conversationService } from '@/services/conversation.service';
import { memoryService } from '@/services/memory.service';
import { useChatStore } from '@/stores/chat';
import { useConversationsStore } from '@/stores/conversations';
import {
  makeChatResponse,
  makeConversation,
  makeMemory,
  makeMessage,
  paginated,
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

describe('the streaming seam', () => {
  it('accumulates text and tracks which tools are running', () => {
    const chat = useChatStore();

    chat.applyStreamEvent({ type: 'text', delta: 'Bugun ' });
    chat.applyStreamEvent({ type: 'text', delta: '12 ta savdo' });
    chat.applyStreamEvent({
      type: 'tool-started',
      call: { callId: 'c1', name: 'get_sales_summary' },
    });

    expect(chat.streamingText).toBe('Bugun 12 ta savdo');
    expect(chat.runningTools).toHaveLength(1);

    chat.applyStreamEvent({
      type: 'tool-finished',
      call: {
        callId: 'c1',
        name: 'get_sales_summary',
        arguments: {},
        status: 'succeeded',
        result: 'done',
        data: null,
        durationMs: 10,
      },
    });

    expect(chat.runningTools).toHaveLength(0);
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
