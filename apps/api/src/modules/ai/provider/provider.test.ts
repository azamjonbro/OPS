import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { AiProviderError } from './ai-error.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import {
  anthropicTextResponse,
  anthropicToolResponse,
  createProviderHttpDouble,
  openAiTextResponse,
  openAiToolResponse,
  type ScriptedHttpResponse,
} from './provider-test-double.js';
import type { AiCompletionRequest } from './ai-provider.js';

const silentLogger = pino({ level: 'silent' });

const buildOpenAi = (script: ScriptedHttpResponse[], maxRetries = 0) => {
  const double = createProviderHttpDouble(script);
  const provider = new OpenAiProvider({
    apiKey: 'sk-test-key-never-real',
    model: 'gpt-5',
    baseUrl: 'https://ai-provider.test/v1',
    timeoutMs: 50,
    maxRetries,
    maxOutputTokens: 1_024,
    fetchImpl: double.fetchImpl,
    logger: silentLogger,
    sleep: async () => undefined,
  });

  return { provider, double };
};

const buildAnthropic = (script: ScriptedHttpResponse[]) => {
  const double = createProviderHttpDouble(script);
  const provider = new AnthropicProvider({
    apiKey: 'sk-ant-test-key',
    model: 'claude-opus-5',
    baseUrl: 'https://ai-provider.test/v1',
    timeoutMs: 50,
    maxRetries: 0,
    maxOutputTokens: 1_024,
    fetchImpl: double.fetchImpl,
    logger: silentLogger,
    sleep: async () => undefined,
  });

  return { provider, double };
};

const TOOLS: AiCompletionRequest['tools'] = [
  {
    name: 'get_sales_summary',
    description: 'Sales totals for a date range',
    parameters: {
      type: 'object',
      properties: { from: { type: 'string' }, to: { type: 'string' } },
      required: ['from', 'to'],
    },
  },
];

describe('OpenAI provider', () => {
  it('returns text and usage from a successful reply', async () => {
    const { provider } = buildOpenAi([
      { body: openAiTextResponse('Bugungi savdo 4 200 000 so‘m.') },
    ]);

    const completion = await provider.complete({ messages: [], tools: [] });

    expect(completion).toEqual({
      content: 'Bugungi savdo 4 200 000 so‘m.',
      toolCalls: [],
      model: 'gpt-5',
      usage: { promptTokens: 120, completionTokens: 30 },
    });
  });

  it('sends the tool definitions and the configured model', async () => {
    const { provider, double } = buildOpenAi([{ body: openAiTextResponse('ok') }]);

    await provider.complete({
      messages: [
        { role: 'system', content: 'You are Hadiya.' },
        { role: 'user', content: 'Bugungi savdo qancha?' },
      ],
      tools: TOOLS,
    });

    const call = double.calls[0];
    expect(call?.url).toBe('https://ai-provider.test/v1/chat/completions');
    expect(call?.body).toMatchObject({
      model: 'gpt-5',
      tool_choice: 'auto',
      // Reasoning models reject `max_tokens`.
      max_completion_tokens: 1_024,
    });
    expect(call?.body.tools).toEqual([
      { type: 'function', function: expect.objectContaining({ name: 'get_sales_summary' }) },
    ]);
    expect(call?.headers.authorization).toBe('Bearer sk-test-key-never-real');
  });

  it('reads a tool call with its parsed arguments', async () => {
    const { provider } = buildOpenAi([
      { body: openAiToolResponse('get_sales_summary', { from: '2026-09-04', to: '2026-09-04' }) },
    ]);

    const completion = await provider.complete({ messages: [], tools: TOOLS });

    expect(completion.content).toBe('');
    expect(completion.toolCalls).toEqual([
      {
        callId: 'call_1',
        name: 'get_sales_summary',
        arguments: { from: '2026-09-04', to: '2026-09-04' },
      },
    ]);
  });

  it('sends a tool result back with the id of the call it answers', async () => {
    const { provider, double } = buildOpenAi([{ body: openAiTextResponse('done') }]);

    await provider.complete({
      messages: [
        { role: 'user', content: 'sales?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ callId: 'call_1', name: 'get_sales_summary', arguments: { from: 'a' } }],
        },
        { role: 'tool', content: '3 sales', toolCallId: 'call_1' },
      ],
      tools: TOOLS,
    });

    expect(double.calls[0]?.body.messages).toEqual([
      { role: 'user', content: 'sales?' },
      {
        role: 'assistant',
        // Null, not an empty string, on a turn that only calls tools.
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_sales_summary', arguments: '{"from":"a"}' },
          },
        ],
      },
      { role: 'tool', content: '3 sales', tool_call_id: 'call_1' },
    ]);
  });

  it('survives tool arguments the model wrote badly', async () => {
    const { provider } = buildOpenAi([
      {
        body: {
          model: 'gpt-5',
          choices: [
            {
              message: {
                role: 'assistant',
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    type: 'function',
                    function: { name: 'get_memory', arguments: '{oops' },
                  },
                ],
              },
            },
          ],
        },
      },
    ]);

    const completion = await provider.complete({ messages: [], tools: TOOLS });

    // The call still reaches the registry, which validates it and reports a
    // failure the model can correct — better than ending the turn.
    expect(completion.toolCalls).toEqual([{ callId: 'c1', name: 'get_memory', arguments: {} }]);
  });

  it.each([
    [401, 'invalid_credentials'],
    [403, 'invalid_credentials'],
    [404, 'model_unavailable'],
    [429, 'rate_limited'],
    [500, 'upstream_error'],
  ])('maps HTTP %i to %s', async (status, kind) => {
    const { provider } = buildOpenAi([{ status, body: { error: { message: 'nope' } } }]);

    const error = await provider.complete({ messages: [], tools: [] }).catch((caught) => caught);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe(kind);
  });

  it('retries a rate limit and honours Retry-After', async () => {
    const sleeps: number[] = [];
    const double = createProviderHttpDouble([
      { status: 429, headers: { 'retry-after': '3' } },
      { body: openAiTextResponse('recovered') },
    ]);
    const provider = new OpenAiProvider({
      apiKey: 'sk-test',
      model: 'gpt-5',
      baseUrl: 'https://ai-provider.test/v1',
      timeoutMs: 1_000,
      maxRetries: 2,
      maxOutputTokens: 512,
      fetchImpl: double.fetchImpl,
      logger: silentLogger,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const completion = await provider.complete({ messages: [], tools: [] });

    expect(completion.content).toBe('recovered');
    expect(sleeps).toEqual([3_000]);
  });

  it('does not retry an invalid key', async () => {
    const { provider, double } = buildOpenAi([{ status: 401 }, { status: 401 }], 2);

    await expect(provider.complete({ messages: [], tools: [] })).rejects.toBeInstanceOf(
      AiProviderError,
    );
    expect(double.calls).toHaveLength(1);
  });

  it('gives up on its own timeout instead of hanging', async () => {
    const { provider } = buildOpenAi([{ hang: true }]);

    const error = await provider.complete({ messages: [], tools: [] }).catch((caught) => caught);

    expect((error as AiProviderError).kind).toBe('timeout');
  });

  it('reports an unreachable provider as a network failure', async () => {
    const { provider } = buildOpenAi([{ throws: new Error('ECONNREFUSED') }]);

    const error = await provider.complete({ messages: [], tools: [] }).catch((caught) => caught);

    expect((error as AiProviderError).kind).toBe('network');
  });

  it('reports a non-JSON body as malformed', async () => {
    const { provider } = buildOpenAi([{ rawBody: '<html>bad gateway</html>' }]);

    const error = await provider.complete({ messages: [], tools: [] }).catch((caught) => caught);

    expect((error as AiProviderError).kind).toBe('malformed_response');
  });

  it('reports a reply with no message as malformed', async () => {
    const { provider } = buildOpenAi([{ body: { model: 'gpt-5', choices: [] } }]);

    const error = await provider.complete({ messages: [], tools: [] }).catch((caught) => caught);

    expect((error as AiProviderError).kind).toBe('malformed_response');
  });

  it('surfaces a filtered response as a request problem, not an outage', async () => {
    const { provider } = buildOpenAi([
      {
        body: {
          model: 'gpt-5',
          choices: [
            { message: { role: 'assistant', content: '' }, finish_reason: 'content_filter' },
          ],
        },
      },
    ]);

    const error = (await provider
      .complete({ messages: [], tools: [] })
      .catch((caught) => caught)) as AiProviderError;

    expect(error.kind).toBe('content_filtered');
    expect(error.toApiError().statusCode).toBe(400);
  });

  it('never leaks the key into the error a caller sees', async () => {
    const { provider } = buildOpenAi([
      { status: 401, body: { error: { message: 'bad key sk-test-key-never-real' } } },
    ]);

    const error = (await provider
      .complete({ messages: [], tools: [] })
      .catch((caught) => caught)) as AiProviderError;
    const surfaced = `${error.message} ${JSON.stringify(error.toApiError().details)}`;

    expect(surfaced).not.toContain('sk-test-key-never-real');
    expect(error.toApiError().statusCode).toBe(503);
  });
});

describe('Anthropic provider', () => {
  it('returns text and usage from a successful reply', async () => {
    const { provider } = buildAnthropic([{ body: anthropicTextResponse('Salom!') }]);

    const completion = await provider.complete({ messages: [], tools: [] });

    expect(completion).toEqual({
      content: 'Salom!',
      toolCalls: [],
      model: 'claude-opus-5',
      usage: { promptTokens: 140, completionTokens: 40 },
    });
  });

  it('lifts system messages out and turns a tool result into a user turn', async () => {
    const { provider, double } = buildAnthropic([{ body: anthropicTextResponse('ok') }]);

    await provider.complete({
      messages: [
        { role: 'system', content: 'You are Hadiya.' },
        { role: 'user', content: 'sales?' },
        {
          role: 'assistant',
          content: '',
          toolCalls: [{ callId: 'toolu_1', name: 'get_sales_summary', arguments: { from: 'a' } }],
        },
        { role: 'tool', content: '3 sales', toolCallId: 'toolu_1' },
      ],
      tools: TOOLS,
    });

    const body = double.calls[0]?.body;
    expect(body?.system).toBe('You are Hadiya.');
    expect(body?.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'sales?' }] },
      {
        role: 'assistant',
        content: [
          { type: 'tool_use', id: 'toolu_1', name: 'get_sales_summary', input: { from: 'a' } },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: '3 sales' }],
      },
    ]);
    expect(body?.tools).toEqual([
      expect.objectContaining({ name: 'get_sales_summary', input_schema: expect.any(Object) }),
    ]);
    expect(double.calls[0]?.headers['x-api-key']).toBe('sk-ant-test-key');
  });

  it('reads a tool call, whose arguments arrive already parsed', async () => {
    const { provider } = buildAnthropic([
      {
        body: anthropicToolResponse('get_sales_summary', { from: '2026-09-04', to: '2026-09-04' }),
      },
    ]);

    const completion = await provider.complete({ messages: [], tools: TOOLS });

    expect(completion.toolCalls).toEqual([
      {
        callId: 'toolu_1',
        name: 'get_sales_summary',
        arguments: { from: '2026-09-04', to: '2026-09-04' },
      },
    ]);
  });

  it('maps a rejected key the same way as every other vendor', async () => {
    const { provider } = buildAnthropic([
      { status: 401, body: { error: { type: 'authentication_error' } } },
    ]);

    const error = (await provider
      .complete({ messages: [], tools: [] })
      .catch((caught) => caught)) as AiProviderError;

    expect(error.kind).toBe('invalid_credentials');
    expect(error.toApiError().statusCode).toBe(503);
  });
});
