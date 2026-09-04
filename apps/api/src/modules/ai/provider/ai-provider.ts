import type { MessageRole } from '@hadiya/shared';

/**
 * What a model provider must offer.
 *
 * Phase 4 supplies the real implementation (OpenAI, Anthropic, …); everything
 * in this phase — context building, tool dispatch, persistence — is written
 * against this interface, so the agent can be exercised end to end with a fake
 * and never needs a paid API call in a test.
 */
export interface AiPromptMessage {
  role: MessageRole;
  content: string;
  /** Set on a `tool` message: which call it answers. */
  toolCallId?: string;
  /** Tool requests the assistant made, on an assistant message. */
  toolCalls?: Array<{ callId: string; name: string; arguments: Record<string, unknown> }>;
}

/** A tool as the model sees it: a name, a description and an argument schema. */
export interface AiToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the arguments. */
  parameters: Record<string, unknown>;
}

export interface AiCompletionRequest {
  messages: AiPromptMessage[];
  tools: AiToolDefinition[];
  /** Cap on the reply, not on the prompt. */
  maxOutputTokens?: number;
}

export interface AiToolCallRequest {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AiCompletion {
  /** The assistant's text. Empty when it only asked for tools. */
  content: string;
  toolCalls: AiToolCallRequest[];
  model: string;
  usage: { promptTokens: number | null; completionTokens: number | null };
}

/** A piece of a streamed reply, for the streaming seam below. */
export interface AiCompletionChunk {
  /** Text produced since the previous chunk. */
  delta: string;
  done: boolean;
}

export interface AiProvider {
  readonly name: string;
  readonly isConfigured: boolean;
  /** The model in use, when the provider knows it before answering. */
  readonly model?: string;
  /**
   * Whether `stream` is implemented. The agent uses `complete` today; a
   * provider that streams adds the method below and flips this flag, and
   * nothing above the interface has to be rewritten to take advantage of it.
   */
  readonly supportsStreaming?: boolean;
  complete: (request: AiCompletionRequest) => Promise<AiCompletion>;
  /**
   * Reserved extension point: emits text as it arrives and resolves with the
   * same completion `complete` would have returned.
   */
  stream?: (
    request: AiCompletionRequest,
    onChunk: (chunk: AiCompletionChunk) => void,
  ) => Promise<AiCompletion>;
}
