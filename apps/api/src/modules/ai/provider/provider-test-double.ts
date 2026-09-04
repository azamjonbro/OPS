import type { FetchLike } from './ai-http.js';

/**
 * A scripted HTTP layer for provider tests.
 *
 * Providers take an injected `fetch`, so their request shape, response parsing
 * and error mapping can all be exercised without a network call — and without
 * spending anything on a model.
 */
export interface RecordedProviderCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

export interface ScriptedHttpResponse {
  status?: number;
  body?: unknown;
  /** Returned instead of `body` when the payload must not be valid JSON. */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Rejects instead of responding, for the network case. */
  throws?: Error;
  /** Never settles until aborted, so the provider's timeout fires. */
  hang?: boolean;
}

export interface ProviderHttpDouble {
  fetchImpl: FetchLike;
  calls: RecordedProviderCall[];
}

export const createProviderHttpDouble = (script: ScriptedHttpResponse[]): ProviderHttpDouble => {
  const calls: RecordedProviderCall[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      headers: { ...((init.headers ?? {}) as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : {},
    });

    const entry = script[index] ?? script.at(-1);
    index += 1;

    if (!entry) {
      throw new Error(`No scripted provider response for ${url}`);
    }

    if (entry.throws) {
      throw entry.throws;
    }

    if (entry.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    }

    if (entry.rawBody !== undefined) {
      return new Response(entry.rawBody, { status: entry.status ?? 200, headers: entry.headers });
    }

    return new Response(JSON.stringify(entry.body ?? {}), {
      status: entry.status ?? 200,
      headers: { 'content-type': 'application/json', ...entry.headers },
    });
  };

  return { fetchImpl, calls };
};

/** An OpenAI reply carrying text. */
export const openAiTextResponse = (content: string) => ({
  model: 'gpt-5',
  choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 30 },
});

/** An OpenAI reply asking for one tool. */
export const openAiToolResponse = (name: string, args: unknown, callId = 'call_1') => ({
  model: 'gpt-5',
  choices: [
    {
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: callId, type: 'function', function: { name, arguments: JSON.stringify(args) } },
        ],
      },
      finish_reason: 'tool_calls',
    },
  ],
  usage: { prompt_tokens: 200, completion_tokens: 25 },
});

export const anthropicTextResponse = (text: string) => ({
  model: 'claude-opus-5',
  content: [{ type: 'text', text }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 140, output_tokens: 40 },
});

export const anthropicToolResponse = (name: string, input: unknown, id = 'toolu_1') => ({
  model: 'claude-opus-5',
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
  usage: { input_tokens: 210, output_tokens: 22 },
});
