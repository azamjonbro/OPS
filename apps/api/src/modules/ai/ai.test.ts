import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { ConversationModel } from '../conversations/conversation.model.js';
import { MessageModel } from '../conversations/message.model.js';
import * as conversationService from '../conversations/conversation.service.js';
import { MemoryModel } from '../memory/memory.model.js';
import * as memoryService from '../memory/memory.service.js';
import { sendMessage } from './agent/agent.service.js';
import { buildContext, CONTEXT_CHARACTER_BUDGET } from './context/context-builder.service.js';
import { createToolRegistry } from './tools/index.js';
import { createScriptedProvider } from './test-support.js';
import { setAiProvider } from './provider/index.js';

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);
afterEach(() => setAiProvider(null));

const signIn = async () => {
  const branch = await createTestBranch();
  const session = await signInAs(app, 'manager', String(branch._id));

  return session;
};

describe('context building', () => {
  it('gives the model a bounded window, not the whole history', async () => {
    const { actor } = await signIn();
    const conversation = await conversationService.createConversation(actor, { title: 'Long' });
    const conversationId = String(conversation._id);

    for (let index = 1; index <= 40; index += 1) {
      await conversationService.appendMessage(actor, {
        conversationId,
        role: index % 2 === 1 ? 'user' : 'assistant',
        content: `Turn ${index}`,
      });
    }

    const context = await buildContext(actor, { conversationId, userMessage: 'Turn 41' });

    // 20 recent turns plus the system prompt — never all 40.
    expect(context.summary.messageCount).toBe(20);
    expect(context.messages[0]?.role).toBe('system');
    expect(context.messages.at(-1)?.content).toBe('Turn 40');
    expect(context.messages).toHaveLength(21);
  });

  it('drops the oldest turns when the character budget is exceeded', async () => {
    const { actor } = await signIn();
    const conversation = await conversationService.createConversation(actor, { title: 'Bulky' });
    const conversationId = String(conversation._id);
    const bulk = 'x'.repeat(2_000);

    for (let index = 1; index <= 10; index += 1) {
      await conversationService.appendMessage(actor, {
        conversationId,
        role: 'user',
        content: `${index} ${bulk}`,
      });
    }

    const context = await buildContext(actor, { conversationId, userMessage: 'next' });
    const used = context.messages.reduce((total, message) => total + message.content.length, 0);

    expect(context.summary.truncatedMessageCount).toBeGreaterThan(0);
    expect(used).toBeLessThanOrEqual(CONTEXT_CHARACTER_BUDGET);
    // The newest turn always survives the trim.
    expect(context.messages.at(-1)?.content.startsWith('10 ')).toBe(true);
  });

  it('puts relevant memories in the system prompt and leaves pending ones out', async () => {
    const { actor } = await signIn();
    const conversation = await conversationService.createConversation(actor, { title: 'Memory' });

    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });
    await memoryService.remember(actor, {
      type: 'fact',
      key: 'unconfirmed_supplier',
      value: 'maybe Anhor',
      source: 'assistant',
      confidence: 0.2,
    });

    const context = await buildContext(actor, {
      conversationId: String(conversation._id),
      userMessage: 'Content tayyorla',
    });

    const systemPrompt = context.messages[0]?.content ?? '';
    expect(systemPrompt).toContain('content_language: uzbek');
    expect(systemPrompt).not.toContain('unconfirmed_supplier');
    expect(context.memories).toHaveLength(1);
  });

  it('keeps a standing instruction even when it shares no words with the question', async () => {
    const { actor } = await signIn();
    const conversation = await conversationService.createConversation(actor, { title: 'Style' });

    await memoryService.remember(actor, {
      type: 'instruction',
      key: 'response_style',
      value: 'always answer briefly',
      source: 'user',
    });

    const context = await buildContext(actor, {
      conversationId: String(conversation._id),
      userMessage: 'Ombordagi qoldiq qancha?',
    });

    expect(context.memories.map((memory) => memory.key)).toContain('response_style');
  });

  it('never mixes another employee’s history or memory into a prompt', async () => {
    const owner = await signIn();
    const stranger = await signIn();

    const conversation = await conversationService.createConversation(owner.actor, {
      title: 'Owner thread',
    });
    await conversationService.appendMessage(owner.actor, {
      conversationId: String(conversation._id),
      role: 'user',
      content: 'Owner secret question',
    });
    await memoryService.remember(owner.actor, {
      type: 'fact',
      key: 'owner_only_fact',
      value: 'confidential',
      source: 'user',
    });

    const context = await buildContext(stranger.actor, {
      conversationId: String(conversation._id),
      userMessage: 'anything',
    });

    expect(context.summary.messageCount).toBe(0);
    expect(context.messages[0]?.content).not.toContain('owner_only_fact');
    expect(context.memories).toHaveLength(0);
  });
});

describe('tool registry', () => {
  it('refuses a tool that is not registered', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();

    const outcome = await registry.execute('drop_database', {}, { actor, conversationId: 'c1' });

    expect(outcome.status).toBe('failed');
    expect(outcome.result.summary).toMatch(/no tool named/i);
  });

  it('rejects arguments that do not match the tool schema', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();

    const outcome = await registry.execute(
      'remember_information',
      { type: 'nonsense', key: 'k' },
      { actor, conversationId: 'c1' },
    );

    expect(outcome.status).toBe('failed');
    expect(await MemoryModel.countDocuments().exec()).toBe(0);
  });

  it('saves a preference through remember_information', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();

    const outcome = await registry.execute(
      'remember_information',
      { type: 'preference', key: 'content_language', value: 'uzbek', confidence: 1 },
      { actor, conversationId: 'c1' },
    );

    expect(outcome.status).toBe('succeeded');
    const stored = await MemoryModel.findOne({ key: 'content_language' }).lean().exec();
    expect(stored).toMatchObject({ value: 'uzbek', status: 'active', source: 'assistant' });
  });

  it('refuses through the tool when the value is a credential', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();

    const outcome = await registry.execute(
      'remember_information',
      { type: 'fact', key: 'wifi_password', value: 'chilonzor-2026', confidence: 1 },
      { actor, conversationId: 'c1' },
    );

    expect(outcome.result.summary).toMatch(/never saved to memory/i);
    expect(await MemoryModel.countDocuments().exec()).toBe(0);
  });

  it('forgets through forget_information', async () => {
    const { actor } = await signIn();
    const registry = createToolRegistry();
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'response_style',
      value: 'concise',
      source: 'user',
    });

    const outcome = await registry.execute(
      'forget_information',
      { type: 'preference', key: 'response_style' },
      { actor, conversationId: 'c1' },
    );

    expect(outcome.status).toBe('succeeded');
    expect(await memoryService.listActiveMemories(actor, 10)).toHaveLength(0);
  });

  it('advertises every tool with a JSON schema for its arguments', () => {
    const definitions = createToolRegistry().definitions();

    expect(definitions.map((tool) => tool.name)).toEqual([
      'remember_information',
      'get_memory',
      'forget_information',
      'create_reminder',
      'list_reminders',
      'get_reminder',
      'update_reminder',
      'cancel_reminder',
      'create_content_plan',
      'list_content_plans',
      'get_content_plan',
      'update_content_plan',
      'delete_content_plan',
      'create_content_item',
      'update_content_item',
      'delete_content_item',
      'regenerate_content_item',
      'generate_caption',
      'generate_content_ideas',
      'get_sales_summary',
      'get_products',
    ]);
    expect(definitions[0]?.parameters).toMatchObject({ type: 'object' });
  });
});

describe('the agent', () => {
  it('stores the question, the reply, and opens a conversation when none is given', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([{ content: 'Bugungi savdo 4 200 000 so‘m.' }]);

    const result = await sendMessage(actor, { message: 'Bugungi savdo qancha?' }, { provider });

    expect(result.conversationId).toEqual(expect.any(String));
    expect(result.message.content).toBe('Bugungi savdo 4 200 000 so‘m.');

    const conversation = await ConversationModel.findById(result.conversationId).lean().exec();
    expect(conversation).toMatchObject({
      // Titled from the opening line rather than left as "New conversation".
      title: 'Bugungi savdo qancha?',
      messageCount: 2,
    });
    expect(conversation?.lastMessageAt).toBeInstanceOf(Date);

    const messages = await MessageModel.find({ conversation: result.conversationId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(messages[1]?.model).toBe('scripted-model');
  });

  it('hands the model the recent turns and the stored memories', async () => {
    const { actor } = await signIn();
    const conversation = await conversationService.createConversation(actor, { title: 'Ongoing' });
    const conversationId = String(conversation._id);

    await conversationService.appendMessage(actor, {
      conversationId,
      role: 'user',
      content: 'Avvalgi savolim',
    });
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });

    const provider = createScriptedProvider([{ content: 'Tushundim.' }]);
    await sendMessage(actor, { conversationId, message: 'Davom et' }, { provider });

    const sent = provider.requests[0];
    const rendered = JSON.stringify(sent?.messages);

    expect(rendered).toContain('content_language: uzbek');
    expect(rendered).toContain('Avvalgi savolim');
    expect(rendered).toContain('Davom et');
    // The tool list travels with the request.
    expect(sent?.toolNames).toContain('remember_information');
  });

  it('runs a tool the model asks for and records the call in the transcript', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-1',
            name: 'remember_information',
            arguments: {
              type: 'preference',
              key: 'content_language',
              value: 'uzbek',
              confidence: 1,
            },
          },
        ],
      },
      { content: 'Eslab qoldim.' },
    ]);

    const result = await sendMessage(
      actor,
      { message: "Men contentni o'zbek tilida qilishni xohlayman." },
      { provider },
    );

    expect(result.message.content).toBe('Eslab qoldim.');

    const stored = await MemoryModel.findOne({ key: 'content_language' }).lean().exec();
    expect(stored).toMatchObject({ value: 'uzbek', status: 'active' });

    const messages = await MessageModel.find({ conversation: result.conversationId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
    expect(messages.map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);

    const toolCall = messages[1]?.toolCalls[0];
    expect(toolCall).toMatchObject({
      callId: 'call-1',
      name: 'remember_information',
      status: 'succeeded',
    });
    expect(messages[2]?.toolCallId).toBe('call-1');
    // The second call sees the tool result.
    expect(JSON.stringify(provider.requests[1]?.messages)).toContain('Remembered.');
  });

  it('stops asking for tools after the round limit and still answers', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [{ callId: 'c', name: 'get_memory', arguments: { limit: 5 } }],
      },
    ]);

    const result = await sendMessage(actor, { message: 'loop please' }, { provider });

    // The last round is asked with no tools, which forces a written reply.
    expect(provider.requests.at(-1)?.toolNames).toEqual([]);
    expect(result.message.role).toBe('assistant');
  });

  it('keeps the question when the model fails', async () => {
    const { actor } = await signIn();
    const failing = {
      name: 'failing',
      isConfigured: true,
      complete: () => Promise.reject(new Error('provider is down')),
    };

    await expect(sendMessage(actor, { message: 'Savol' }, { provider: failing })).rejects.toThrow(
      /provider is down/,
    );

    // The user's turn was stored before the model was called.
    const stored = await MessageModel.find({}).lean().exec();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ role: 'user', content: 'Savol' });
  });

  it('surfaces a memory that needs confirmation instead of using it silently', async () => {
    const { actor } = await signIn();
    const provider = createScriptedProvider([
      {
        content: '',
        toolCalls: [
          {
            callId: 'call-1',
            name: 'remember_information',
            arguments: {
              type: 'fact',
              key: 'supplier_choice',
              value: 'probably Anhor',
              confidence: 0.3,
            },
          },
        ],
      },
      { content: 'Aniqlashtiring.' },
    ]);

    const result = await sendMessage(actor, { message: 'Yetkazib beruvchi?' }, { provider });

    expect(result.pendingMemories).toHaveLength(1);
    expect(result.pendingMemories[0]).toMatchObject({ key: 'supplier_choice' });
    expect(result.usedMemories).toHaveLength(0);
  });
});

describe('POST /api/v1/ai/chat', () => {
  it('is refused without a token', async () => {
    const response = await request(app).post('/api/v1/ai/chat').send({ message: 'hello' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('answers through the endpoint and reports the memories it used', async () => {
    const { actor, authorization } = await signIn();
    setAiProvider(createScriptedProvider([{ content: 'Qisqa javob.' }]));
    await memoryService.remember(actor, {
      type: 'instruction',
      key: 'response_style',
      value: 'always answer briefly',
      source: 'user',
    });

    const response = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', authorization)
      .send({ message: 'Savdo hisoboti' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      conversationId: expect.any(String),
      message: expect.objectContaining({ role: 'assistant', content: 'Qisqa javob.' }),
    });
    expect(response.body.data.usedMemories[0]).toMatchObject({ key: 'response_style' });
  });

  it('reports a 503 rather than inventing an answer when no model is configured', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', authorization)
      .send({ message: 'hello' });

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body.error.details).toMatchObject({ integration: 'ai' });
  });

  it('will not continue another employee’s conversation', async () => {
    const owner = await signIn();
    const stranger = await signIn();
    setAiProvider(createScriptedProvider([{ content: 'ok' }]));

    const conversation = await conversationService.createConversation(owner.actor, {
      title: 'Owner thread',
    });

    const response = await request(app)
      .post('/api/v1/ai/chat')
      .set('Authorization', stranger.authorization)
      .send({ conversationId: String(conversation._id), message: 'let me in' });

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(await MessageModel.countDocuments().exec()).toBe(0);
  });

  it('lists the tools the assistant may call', async () => {
    const { authorization } = await signIn();

    const response = await request(app)
      .get('/api/v1/ai/status')
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    const names = response.body.data.tools.map((tool: { name: string }) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'remember_information',
        'create_reminder',
        'create_content_plan',
        'generate_caption',
        'get_sales_summary',
        'get_products',
      ]),
    );

    // Reading anything — a memory, a plan, the sales figures — is never a write,
    // and generating a caption stores nothing either.
    const readOnly = response.body.data.tools.filter((tool: { mutates: boolean }) => !tool.mutates);
    expect(readOnly.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        'get_memory',
        'list_reminders',
        'list_content_plans',
        'generate_caption',
        'generate_content_ideas',
        'get_sales_summary',
        'get_products',
      ]),
    );

    // Only what cannot be undone asks first.
    expect(
      response.body.data.tools
        .filter((tool: { requiresConfirmation: boolean }) => tool.requiresConfirmation)
        .map((tool: { name: string }) => tool.name),
    ).toEqual(['delete_content_plan', 'delete_content_item']);
  });
});
