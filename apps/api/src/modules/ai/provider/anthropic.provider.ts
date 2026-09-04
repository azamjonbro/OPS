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

/** Anthropic's wire format, only as far as this provider uses it. */
interface AnthropicContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicResponse {
  model?: string;
  content?: AnthropicContentBlock[];
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export interface AnthropicProviderOptions {
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

const ANTHROPIC_VERSION = '2023-06-01';

/**
 * Anthropic differs from Hadiya's prompt shape in two ways, and both are
 * handled here so nothing above this file has to know.
 *
 * System instructions are a top-level field rather than a message, and a tool
 * result is a `user` turn carrying a `tool_result` block rather than a role of
 * its own. Consecutive turns of the same role are merged, which the API
 * requires.
 */
const toAnthropicMessages = (
  messages: AiPromptMessage[],
): { system: string; conversation: AnthropicMessage[] } => {
  const systemParts: string[] = [];
  const conversation: AnthropicMessage[] = [];

  const push = (role: AnthropicMessage['role'], blocks: AnthropicContentBlock[]): void => {
    if (blocks.length === 0) {
      return;
    }

    const last = conversation.at(-1);

    if (last?.role === role) {
      last.content.push(...blocks);
      return;
    }

    conversation.push({ role, content: blocks });
  };

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content);
      continue;
    }

    if (message.role === 'tool') {
      push('user', [
        {
          type: 'tool_result',
          tool_use_id: message.toolCallId ?? '',
          content: message.content,
        },
      ]);
      continue;
    }

    const blocks: AnthropicContentBlock[] = [];

    if (message.content.length > 0) {
      blocks.push({ type: 'text', text: message.content });
    }

    for (const call of message.toolCalls ?? []) {
      blocks.push({ type: 'tool_use', id: call.callId, name: call.name, input: call.arguments });
    }

    push(message.role === 'assistant' ? 'assistant' : 'user', blocks);
  }

  return { system: systemParts.join('\n\n'), conversation };
};

const readToolCalls = (blocks: AnthropicContentBlock[]): AiToolCallRequest[] =>
  blocks
    .filter((block) => block.type === 'tool_use' && block.name)
    .map((block) => ({
      callId: block.id ?? block.name ?? 'tool_use',
      name: block.name ?? '',
      // Anthropic sends parsed JSON, so there is nothing to decode here.
      arguments:
        typeof block.input === 'object' && block.input !== null && !Array.isArray(block.input)
          ? (block.input as Record<string, unknown>)
          : {},
    }));

/** Anthropic, behind the same `AiProvider` interface as every other vendor. */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly isConfigured = true;
  readonly supportsStreaming = false;

  private readonly log: Logger;

  constructor(private readonly options: AnthropicProviderOptions) {
    this.log = options.logger ?? createLogger('ai-anthropic');
  }

  get model(): string {
    return this.options.model;
  }

  async complete(request: AiCompletionRequest): Promise<AiCompletion> {
    const { system, conversation } = toAnthropicMessages(request.messages);

    const body: Record<string, unknown> = {
      model: this.options.model,
      // Required by this API, unlike OpenAI's optional cap.
      max_tokens: request.maxOutputTokens ?? this.options.maxOutputTokens,
      messages: conversation,
    };

    if (system.length > 0) {
      body.system = system;
    }

    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }));
    }

    const response = await postJson<AnthropicResponse>(
      {
        url: `${this.options.baseUrl.replace(/\/$/, '')}/messages`,
        headers: {
          'x-api-key': this.options.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body,
        endpoint: '/messages',
      },
      {
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
        logger: this.log,
      },
    );

    const blocks = response.content;

    if (!Array.isArray(blocks)) {
      throw new AiProviderError('malformed_response', 'the provider returned no content');
    }

    return {
      content: blocks
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text ?? '')
        .join(''),
      toolCalls: readToolCalls(blocks),
      model: response.model ?? this.options.model,
      usage: {
        promptTokens: response.usage?.input_tokens ?? null,
        completionTokens: response.usage?.output_tokens ?? null,
      },
    };
  }
}
