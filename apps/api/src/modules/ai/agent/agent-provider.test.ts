import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../../test/database.js';
import {
  createTestBranch,
  createTestCategory,
  createTestProduct,
  signInAs,
} from '../../../test/factories.js';
import { createApp } from '../../../app.js';
import { MessageModel } from '../../conversations/message.model.js';
import { MemoryModel } from '../../memory/memory.model.js';
import * as memoryService from '../../memory/memory.service.js';
import * as saleService from '../../sales/sale.service.js';
import { recordMovement } from '../../inventory/inventory.service.js';
import { OpenAiProvider } from '../provider/openai.provider.js';
import {
  createProviderHttpDouble,
  openAiTextResponse,
  openAiToolResponse,
  type ScriptedHttpResponse,
} from '../provider/provider-test-double.js';
import { setAiProvider } from '../provider/index.js';
import { sendMessage } from './agent.service.js';

const app = createApp();
const silentLogger = pino({ level: 'silent' });

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);
afterEach(() => setAiProvider(null));

/**
 * The real provider class, driven by scripted HTTP.
 *
 * These exercise the whole loop the way production runs it — agent, provider,
 * wire format, tool registry — with the network as the only thing replaced, so
 * nothing about the flow is faked and no paid call is made.
 */
const useScriptedOpenAi = (script: ScriptedHttpResponse[]) => {
  const double = createProviderHttpDouble(script);

  setAiProvider(
    new OpenAiProvider({
      apiKey: 'sk-test-key',
      model: 'gpt-5',
      baseUrl: 'https://ai-provider.test/v1',
      timeoutMs: 5_000,
      maxRetries: 0,
      maxOutputTokens: 1_024,
      fetchImpl: double.fetchImpl,
      logger: silentLogger,
      sleep: async () => undefined,
    }),
  );

  return double;
};

const signIn = async () => {
  const branch = await createTestBranch();
  const session = await signInAs(app, 'manager', String(branch._id));

  return {
    branch,
    actor: {
      id: String(session.user._id),
      username: session.user.username,
      fullName: session.user.fullName,
      role: 'manager' as const,
      branchId: String(branch._id),
    },
  };
};

describe('the full loop through the real provider', () => {
  it('answers a plain question', async () => {
    useScriptedOpenAi([{ body: openAiTextResponse('Salom! Men Hadiya yordamchisiman.') }]);
    const { actor } = await signIn();

    const result = await sendMessage(actor, { message: "Salom, o'zingni tanishtir." });

    expect(result.message.content).toBe('Salom! Men Hadiya yordamchisiman.');
    expect(result.message.model).toBe('gpt-5');
    expect(result.message.usage).toEqual({ promptTokens: 120, completionTokens: 30 });
  });

  it('runs a sales tool the model asks for and answers from its result', async () => {
    const { actor, branch } = await signIn();
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id));

    await recordMovement({
      actorId: actor.id,
      productId: String(product._id),
      branchId: String(branch._id),
      type: 'purchase',
      quantity: 10,
      reference: { kind: 'manual', id: null },
    });
    await saleService.createSale(actor, {
      items: [{ productId: String(product._id), quantity: 3 }],
      payments: [{ method: 'cash', amount: 3_600_000 }],
    });

    const today = new Date().toISOString().slice(0, 10);
    const double = useScriptedOpenAi([
      { body: openAiToolResponse('get_sales_summary', { from: today, to: today }) },
      { body: openAiTextResponse('Bugun 1 ta sotuv, jami 36 000 so‘m.') },
    ]);

    const result = await sendMessage(actor, { message: "Bugungi savdoni ko'rsat." });

    expect(result.message.content).toBe('Bugun 1 ta sotuv, jami 36 000 so‘m.');

    // The tool ran for real against the sales service.
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
    expect(messages[1]?.toolCalls[0]).toMatchObject({
      name: 'get_sales_summary',
      status: 'succeeded',
    });
    expect(messages[2]?.content).toContain('1 sale(s)');

    // The second request carried the tool result back to the model.
    const secondBody = double.calls[1]?.body as { messages: Array<{ role: string }> };
    expect(secondBody.messages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('stops after the round limit instead of looping', async () => {
    const { actor } = await signIn();
    const today = new Date().toISOString().slice(0, 10);
    // The model asks for a tool every single time it is given the chance.
    const double = useScriptedOpenAi([
      { body: openAiToolResponse('get_sales_summary', { from: today, to: today }) },
    ]);

    const result = await sendMessage(actor, { message: 'loop' });

    // Four calls: three tool rounds, then one final call with no tools.
    expect(double.calls).toHaveLength(4);
    expect(double.calls.at(-1)?.body.tools).toBeUndefined();
    expect(result.message.role).toBe('assistant');
  });

  it('sends the system prompt, the memories and the tools in one request', async () => {
    const { actor } = await signIn();
    await memoryService.remember(actor, {
      type: 'preference',
      key: 'content_language',
      value: 'uzbek',
      source: 'user',
    });
    await memoryService.remember(actor, {
      type: 'fact',
      key: 'unconfirmed_guess',
      value: 'maybe something',
      source: 'assistant',
      confidence: 0.2,
    });
    const forgotten = await memoryService.remember(actor, {
      type: 'fact',
      key: 'old_fact',
      value: 'no longer true',
      source: 'user',
    });
    await memoryService.forget(actor, { id: String(forgotten.memory?._id) });

    const double = useScriptedOpenAi([{ body: openAiTextResponse('ok') }]);
    await sendMessage(actor, { message: 'Nima eslaysan?' });

    const body = double.calls[0]?.body as {
      messages: Array<{ role: string; content: string | null }>;
      tools: Array<{ function: { name: string } }>;
    };
    const system = body.messages[0];

    expect(system?.role).toBe('system');
    expect(system?.content).toContain('content_language: uzbek');
    // Pending and forgotten memories never reach the model.
    expect(system?.content).not.toContain('unconfirmed_guess');
    expect(system?.content).not.toContain('old_fact');
    expect(body.tools.map((tool) => tool.function.name)).toContain('get_sales_summary');
  });

  it('keeps another employee’s memory out of the prompt', async () => {
    const owner = await signIn();
    const other = await signIn();

    await memoryService.remember(owner.actor, {
      type: 'fact',
      key: 'owner_only',
      value: 'confidential figure',
      source: 'user',
    });

    const double = useScriptedOpenAi([{ body: openAiTextResponse('ok') }]);
    await sendMessage(other.actor, { message: 'Nima eslaysan?' });

    expect(JSON.stringify(double.calls[0]?.body)).not.toContain('confidential figure');
  });

  it('keeps a replayed tool exchange valid for the provider', async () => {
    const { actor } = await signIn();
    const today = new Date().toISOString().slice(0, 10);

    // First turn: the model calls a tool, then answers.
    useScriptedOpenAi([
      { body: openAiToolResponse('get_sales_summary', { from: today, to: today }) },
      { body: openAiTextResponse('Bugun sotuv yo‘q.') },
    ]);
    const first = await sendMessage(actor, { message: 'Bugungi savdo?' });

    // Second turn replays that exchange out of stored history.
    const double = useScriptedOpenAi([{ body: openAiTextResponse('Yana nimadir?') }]);
    await sendMessage(actor, { conversationId: first.conversationId, message: 'Rahmat' });

    const sent = double.calls[0]?.body as {
      messages: Array<{ role: string; tool_calls?: Array<{ id: string }>; tool_call_id?: string }>;
    };
    const requested = sent.messages.flatMap((message) =>
      (message.tool_calls ?? []).map((call) => call.id),
    );
    const answered = sent.messages
      .filter((message) => message.role === 'tool')
      .map((message) => message.tool_call_id);

    // Every request has exactly one answer, and no answer is orphaned — the
    // shape a provider rejects the whole call over.
    expect(requested).toHaveLength(1);
    expect(answered).toEqual(requested);
  });

  it('surfaces a provider failure as a dependency outage and keeps the question', async () => {
    const { actor } = await signIn();
    useScriptedOpenAi([{ status: 401, body: { error: { message: 'invalid api key' } } }]);

    const error = (await sendMessage(actor, { message: 'Savol' }).catch(
      (caught: unknown) => caught,
    )) as { statusCode?: number; message: string };

    // Mapped, not raw: a rejected key is our outage, so it is a 503 and the
    // credential never appears in what the caller sees.
    expect(error.statusCode).toBe(503);
    expect(error.message).toMatch(/api key was rejected/i);
    expect(error.message).not.toContain('sk-');
    // The user's turn survives even though the reply never arrived.
    const stored = await MessageModel.find({}).lean().exec();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.role).toBe('user');
    // Nothing was written to memory by a failed turn.
    expect(await MemoryModel.countDocuments().exec()).toBe(0);
  });
});
