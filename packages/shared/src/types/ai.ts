import type { AgentRunSummary } from './agent.js';
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
  /**
   * How the run got to that reply: which tools ran, which failed, what is still
   * waiting on the person.
   *
   * Optional so that every client written against the earlier contract keeps
   * working untouched, and so the field can be omitted from a response that had
   * no run behind it. When it is present it is the authoritative account of
   * what happened — the prose above it is the model's account, and only this
   * one is generated from what the tools actually returned.
   */
  agent?: AgentRunSummary;
}

/** How a prompt was assembled, useful for debugging and for the UI. */
export interface ContextSummary {
  messageCount: number;
  memoryCount: number;
  /** Messages left out because the budget ran out. */
  truncatedMessageCount: number;
  estimatedTokens: number;
}

/** Tokens spent over a period, as the provider reported them at the time. */
export interface AiUsageTotals {
  /** Assistant turns that carried a usage report. */
  turns: number;
  promptTokens: number;
  completionTokens: number;
  /** ISO-8601 bounds of the period these totals cover, or null when empty. */
  firstAt: string | null;
  lastAt: string | null;
}

export interface AiUsageByModel {
  model: string;
  turns: number;
  promptTokens: number;
  completionTokens: number;
}

/**
 * What the assistant has cost, from Hadiya's own stored token counts.
 *
 * Deliberately carries no money. The rate depends on the plan, the model
 * version and the date — none of which the server knows — so a figure here
 * would be confidently wrong. The provider's own balance is not readable
 * either: OpenAI allows that only from a browser session or an admin key.
 */
export interface AiUsageReport {
  scope: 'own';
  totals: AiUsageTotals;
  byModel: AiUsageByModel[];
  conversationCount: number;
  imageCount: number;
  /**
   * Organisation-wide counts, for a manager or above. Totals only: a spend
   * figure says how much was used, never what anybody asked.
   */
  organisation: {
    totals: AiUsageTotals;
    conversationCount: number;
    imageCount: number;
  } | null;
}
