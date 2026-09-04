import type { Logger } from 'pino';

import { createLogger } from '../../../core/logger/logger.js';
import { AiProviderError } from './ai-error.js';
import { postJson, type FetchLike } from './ai-http.js';
import type {
  AiCompletion,
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

export interface OpenAiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
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
  /** The transport is one JSON POST, so streaming slots in beside `complete`. */
  readonly supportsStreaming = false;

  private readonly log: Logger;

  constructor(private readonly options: OpenAiProviderOptions) {
    this.log = options.logger ?? createLogger('ai-openai');
  }

  get model(): string {
    return this.options.model;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const body: Record<string, unknown> = {
      model: this.options.model,
      messages: request.messages.map(toOpenAiMessage),
      // Reasoning models take `max_completion_tokens`; `max_tokens` is rejected.
      max_completion_tokens: request.maxOutputTokens ?? this.options.maxOutputTokens,
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

    const response = await postJson<OpenAiResponse>(
      {
        url: `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`,
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body,
        endpoint: '/chat/completions',
      },
      {
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
        logger: this.log,
      },
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
}
