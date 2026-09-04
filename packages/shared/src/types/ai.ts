import type { Message } from './conversation.js';
import type { Memory } from './memory.js';

/** What the caller sends to the assistant. */
export interface ChatRequest {
  /** Omit to start a new conversation. */
  conversationId?: string;
  message: string;
}

/**
 * What the assistant answers with, plus enough of the context it used for a
 * client to show why it answered that way.
 */
export interface ChatResponse {
  conversationId: string;
  /** The assistant's reply, already persisted. */
  message: Message;
  /** Memories that were in the prompt, so the answer can be explained. */
  usedMemories: Array<Pick<Memory, 'id' | 'type' | 'key' | 'value'>>;
  /** Memories the assistant wants to keep but that need confirmation first. */
  pendingMemories: Array<Pick<Memory, 'id' | 'type' | 'key' | 'value'>>;
}

/** How a prompt was assembled, useful for debugging and for the UI. */
export interface ContextSummary {
  messageCount: number;
  memoryCount: number;
  /** Messages left out because the budget ran out. */
  truncatedMessageCount: number;
  estimatedTokens: number;
}
