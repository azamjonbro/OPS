import type { Logger } from 'pino';

import { createLogger } from '../../../core/logger/logger.js';
import { AiProviderError } from './ai-error.js';
import { postJson, postSse, type FetchLike } from './ai-http.js';
import type {
  AiCompletion,
  AiCompletionChunk,
  AiCompletionRequest,
  AiPromptMessage,
  AiProvider,
  AiToolCallRequest,
} from './ai-provider.js';

/** The OpenAI wire format, only as far as this provider actually uses it. */
interface OpenAiToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiMessage {
  role: string;
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

interface OpenAiResponse {
  model?: string;
  choices?: Array<{ message?: OpenAiMessage; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** One frame of a streamed reply. Every field is optional by design. */
interface OpenAiStreamChunk {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
  /**
   * How far the endpoint follows OpenAI.
   *
   * `openai` uses the parameters OpenAI's current models require;
   * `openai-compatible` uses only what every OpenAI-shaped service accepts.
   * Defaults to `openai`, which is what the vendor's own endpoint needs.
   */
  compatibility?: 'openai' | 'openai-compatible';
  fetchImpl?: FetchLike;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Translates one of Hadiya's prompt messages into OpenAI's shape.
 *
 * The two disagree in one place that matters: a tool result is its own `tool`
 * role here, and it must carry the id of the call it answers, or the model
 * cannot line the result up with the request it made.
 */
const toOpenAiMessage = (message: AiPromptMessage): OpenAiMessage => {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      content: message.content,
      tool_call_id: message.toolCallId ?? '',
    };
  }

  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      // OpenAI expects null, not an empty string, on a turn that only calls tools.
      content: message.content.length > 0 ? message.content : null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.callId,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      })),
    };
  }

  return { role: message.role, content: message.content };
};

/**
 * Reads the tool calls out of a reply.
 *
 * Arguments arrive as a JSON string the model wrote, so they can be malformed.
 * A call that cannot be parsed is passed on with empty arguments rather than
 * dropped: the registry then validates it against the tool's schema and returns
 * a failure the model can read and correct, which is a better outcome than an
 * exception that ends the turn.
 */
const readToolCalls = (message: OpenAiMessage | undefined, log: Logger): AiToolCallRequest[] =>
  (message?.tool_calls ?? []).flatMap((call) => {
    const name = call.function?.name;

    if (!name) {
      return [];
    }

    let parsed: Record<string, unknown> = {};

    try {
      const raw: unknown = JSON.parse(call.function?.arguments ?? '{}');

      if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
        parsed = raw as Record<string, unknown>;
      }
    } catch {
      log.warn({ tool: name }, 'the model produced tool arguments that are not valid JSON');
    }

    return [{ callId: call.id ?? name, name, arguments: parsed }];
  });

/**
 * OpenAI, behind the `AiProvider` interface.
 *
 * The agent never sees anything in this file: it hands over prompt messages and
 * tool definitions and gets back text, tool calls and usage. Swapping the model
 * or the vendor is a configuration change, not a code change.
 */
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  readonly isConfigured = true;
  readonly supportsStreaming = true;

  private readonly log: Logger;

  constructor(private readonly options: OpenAiProviderOptions) {
    this.log = options.logger ?? createLogger('ai-openai');
  }

  get model(): string {
    return this.options.model;
  }

  /**
   * The request body, built once for both paths.
   *
   * Streaming and not streaming must ask the model for exactly the same thing —
   * the same messages, the same tools, the same ceiling — or the streamed
   * answer is quietly a different answer, and only one of the two is ever
   * covered by a test.
   */
  private get isStrictOpenAi(): boolean {
    return (this.options.compatibility ?? 'openai') === 'openai';
  }

  private buildBody(request: AiCompletionRequest): Record<string, unknown> {
    const limit = request.maxOutputTokens ?? this.options.maxOutputTokens;
    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: request.messages.map(toOpenAiMessage),
      // OpenAI's reasoning models require `max_completion_tokens` and reject
      // `max_tokens`; everybody else implementing this API accepts only
      // `max_tokens`. There is no name both will take, so the dialect decides.
      ...(this.isStrictOpenAi ? { max_completion_tokens: limit } : { max_tokens: limit }),
    };

    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }));
      body.tool_choice = 'auto';
    }

    return body;
  }

  private get endpointUrl(): string {
    return `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`;
  }

  private get httpOptions() {
    return {
      timeoutMs: this.options.timeoutMs,
      maxRetries: this.options.maxRetries,
      ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
      logger: this.log,
    };
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const body = this.buildBody(request);

    const response = await postJson<OpenAiResponse>(
      {
        url: this.endpointUrl,
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body,
        endpoint: '/chat/completions',
      },
      this.httpOptions,
    );

    const choice = response.choices?.[0];

    if (!choice?.message) {
      throw new AiProviderError('malformed_response', 'the provider returned no message');
    }

    if (choice.finish_reason === 'content_filter') {
      throw new AiProviderError('content_filtered', 'the provider filtered this response');
    }

    return {
      content: choice.message.content ?? '',
      toolCalls: readToolCalls(choice.message, this.log),
      model: response.model ?? this.options.model,
      usage: {
        promptTokens: response.usage?.prompt_tokens ?? null,
        completionTokens: response.usage?.completion_tokens ?? null,
      },
    };
  }

  /**
   * The same completion, delivered as it is written.
   *
   * It resolves with exactly what `complete` would have returned — the whole
   * text, the tool calls, the usage — so nothing above this line has to know
   * which path produced it. The callback is a *view* of the answer arriving,
   * not the answer itself: a caller that ignores it loses nothing.
   *
   * Tool calls arrive in pieces too, and are reassembled by their index rather
   * than their id, because only the first frame of a call carries an id while
   * every frame carries the index. Getting that wrong produces a plausible
   * looking tool call with half its arguments, which the registry would then
   * reject for reasons nobody could trace back to here.
   */
  async stream(
    request: AiCompletionRequest,
    onChunk: (chunk: AiCompletionChunk) => void,
  ): Promise<AiCompletion> {
    const body = this.buildBody(request);

    // Usage is not sent on a streamed reply unless it is asked for, and without
    // it every streamed turn would be recorded as costing nothing. Asked for
    // only where it is certainly understood: a service that rejects an unknown
    // field would fail the whole request, and losing a token count is a far
    // smaller loss than losing the answer. The run's round and call ceilings
    // still hold when the count is missing.
    if (this.isStrictOpenAi) {
      body.stream_options = { include_usage: true };
    }

    let content = '';
    let model: string | undefined;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    const partials = new Map<number, { id?: string; name?: string; arguments: string }>();

    await postSse(
      {
        url: this.endpointUrl,
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body,
        endpoint: '/chat/completions (stream)',
      },
      {
        ...this.httpOptions,
        onLine: (payload) => {
          let frame: OpenAiStreamChunk;

          try {
            frame = JSON.parse(payload) as OpenAiStreamChunk;
          } catch {
            // A frame that is not JSON is a frame this provider does not
            // understand; dropping it loses a token rather than the answer.
            this.log.warn('the provider sent a stream frame that is not JSON');

            return;
          }

          model ??= frame.model;

          if (frame.usage) {
            usage = frame.usage;
          }

          const choice = frame.choices?.[0];

          if (!choice) {
            return;
          }

          const delta = choice.delta?.content;

          if (typeof delta === 'string' && delta.length > 0) {
            content += delta;
            onChunk({ delta, done: false });
          }

          for (const call of choice.delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            const partial = partials.get(index) ?? { arguments: '' };

            partials.set(index, {
              id: call.id ?? partial.id,
              name: call.function?.name ?? partial.name,
              arguments: partial.arguments + (call.function?.arguments ?? ''),
            });
          }

          if (choice.finish_reason === 'content_filter') {
            throw new AiProviderError('content_filtered', 'the provider filtered this response');
          }
        },
      },
    );

    onChunk({ delta: '', done: true });

    const assembled: OpenAiMessage = {
      role: 'assistant',
      content,
      tool_calls: [...partials.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
        })),
    };

    return {
      content,
      toolCalls: readToolCalls(assembled, this.log),
      model: model ?? this.options.model,
      usage: {
        promptTokens: usage?.prompt_tokens ?? null,
        completionTokens: usage?.completion_tokens ?? null,
      },
    };
  }
}
