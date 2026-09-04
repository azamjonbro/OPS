import type {
  ConversationStatus,
  MessageRole,
  ToolCallStatus,
} from '../constants/conversations.js';
import type { Entity } from './entity.js';

export interface Conversation extends Entity {
  /** Id of the employee who owns it. Conversations are never shared. */
  user: string;
  title: string;
  status: ConversationStatus;
  /** ISO-8601; drives the "most recent first" ordering of the list. */
  lastMessageAt: string | null;
  messageCount: number;
}

/** One tool the assistant asked for, and what came back. */
export interface MessageToolCall {
  /** Id the model used to tie its request to this result. */
  callId: string;
  /** Registered tool name, e.g. `remember_information`. */
  name: string;
  /** Arguments as validated by the tool's schema. */
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  /** Result summary, or the error message when the call failed. */
  result: string | null;
  durationMs: number | null;
}

export interface MessageUsage {
  promptTokens: number | null;
  completionTokens: number | null;
}

export interface Message extends Entity {
  conversation: string;
  user: string;
  role: MessageRole;
  content: string;
  /** Present on assistant messages that asked for tools. */
  toolCalls: MessageToolCall[];
  /** Set on a `tool` message: which call it answers. */
  toolCallId: string | null;
  /** Model that produced an assistant message. */
  model: string | null;
  usage: MessageUsage | null;
}
