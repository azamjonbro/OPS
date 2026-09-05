import { formatIsoDateInTimeZone } from '@hadiya/shared';
import { pino } from 'pino';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { config } from '../../../config/index.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../../test/database.js';
import { createTestBranch, signInAs } from '../../../test/factories.js';
import { createApp } from '../../../app.js';
import type { BillzCapabilityRunner } from '../../billz/index.js';
import { MessageModel } from '../../conversations/message.model.js';
import { MemoryModel } from '../../memory/memory.model.js';
import * as memoryService from '../../memory/memory.service.js';
import { createBillzTools } from '../tools/billz.tools.js';
import { ToolRegistry } from '../tools/tool-registry.js';
import { MEMORY_TOOLS } from '../tools/memory.tools.js';
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

  return { branch, actor: session.actor };
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

  it('runs a Billz tool the model asks for and answers from its result', async () => {
    const { actor } = await signIn();

    // Billz stands in for the till, so the figures come from a scripted runner
    // rather than from a row this test inserted. That is the whole point of the
    // change: Hadiya no longer keeps its own copy of what was sold.
    const asked: Array<{ from: string; to: string }> = [];
    const runner = {
      getSalesSummary: async (args: { from: string; to: string }) => {
        asked.push(args);

        return { netTotal: 3_600_000, saleCount: 1, returnCount: 0, outstandingDebt: 0 };
      },
    } as unknown as BillzCapabilityRunner;

    const registry = new ToolRegistry();
    for (const tool of [...MEMORY_TOOLS, ...createBillzTools(() => runner)]) {
      registry.register(tool);
    }

    // The user's today, not the server's — which is what the model is told in
    // its instructions and what the sales tool reads a bare date as.
    const today = formatIsoDateInTimeZone(new Date(), actor.timezone);
    const double = useScriptedOpenAi([
      { body: openAiToolResponse('billz_get_sales_summary', { from: today, to: today }) },
      { body: openAiTextResponse('Bugun 1 ta sotuv, jami 36 000 so‘m.') },
    ]);

    const result = await sendMessage(actor, { message: "Bugungi savdoni ko'rsat." }, { registry });

    expect(result.message.content).toBe('Bugun 1 ta sotuv, jami 36 000 so‘m.');
    expect(asked).toEqual([{ from: today, to: today }]);

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
      name: 'billz_get_sales_summary',
      status: 'succeeded',
    });
    // The model reads formatted money, never minor units it would have to divide.
    expect(messages[2]?.content).toContain('1 sale(s)');
    expect(messages[2]?.content).not.toContain('3600000');

    // The structured payload is stored for the chat to render, and is not what
    // the model was shown.
    expect(messages[1]?.toolCalls[0]?.data).toMatchObject({ saleCount: 1 });

    // The second request carried the tool result back to the model.
    const secondBody = double.calls[1]?.body as { messages: Array<{ role: string }> };
    expect(secondBody.messages.some((message) => message.role === 'tool')).toBe(true);
  });

  it('stops after the round limit instead of looping', async () => {
    const { actor } = await signIn();
    // The user's today, not the server's — which is what the model is told in
    // its instructions and what the sales tool reads a bare date as.
    const today = formatIsoDateInTimeZone(new Date(), actor.timezone);
    // The model asks for a tool every single time it is given the chance.
    const double = useScriptedOpenAi([
      { body: openAiToolResponse('get_sales_summary', { from: today, to: today }) },
    ]);

    const result = await sendMessage(actor, { message: 'loop' });

    // Every configured tool round, then one final call with no tools. The
    // limit is configuration now rather than a constant, so the assertion
    // reads it from the same place the loop does.
    expect(double.calls).toHaveLength(config.agent.maxToolRounds + 1);
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
    expect(body.tools.map((tool) => tool.function.name)).toContain('billz_get_sales_summary');
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
    // The user's today, not the server's — which is what the model is told in
    // its instructions and what the sales tool reads a bare date as.
    const today = formatIsoDateInTimeZone(new Date(), actor.timezone);

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
