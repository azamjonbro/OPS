import {
  formatInTimeZone,
  MEMORY_CONTEXT_LIMIT,
  type AuthenticatedUser,
  type ContextSummary,
} from '@hadiya/shared';

import * as conversationService from '../../conversations/conversation.service.js';
import type { MessageDocument } from '../../conversations/message.model.js';
import type { MemoryDocument } from '../../memory/memory.model.js';
import type { AiPromptMessage } from '../provider/ai-provider.js';
import { getMemoryRetriever } from './memory-retriever.js';

/**
 * Turns stored history into the prompt for one request.
 *
 * The rule this exists to enforce: a request never carries the whole
 * conversation. History grows without bound, prompt budgets do not, and sending
 * everything gets slower and more expensive with every turn while burying the
 * part that matters. So the builder takes a bounded window of recent messages,
 * a short list of relevant memories, and stops.
 */

/** Newest messages considered. Older turns are summarised by their absence. */
export const RECENT_MESSAGE_LIMIT = 20;
/** Rough character budget for the whole prompt, before the model's own limits. */
export const CONTEXT_CHARACTER_BUDGET = 12_000;
/** Crude but stable: four characters to a token is close enough to budget with. */
const CHARACTERS_PER_TOKEN = 4;

export interface BuiltContext {
  messages: AiPromptMessage[];
  /** The memories that made it in, so the answer can be explained. */
  memories: MemoryDocument[];
  summary: ContextSummary;
}

const estimateTokens = (messages: AiPromptMessage[]): number =>
  Math.ceil(
    messages.reduce((total, message) => total + message.content.length, 0) / CHARACTERS_PER_TOKEN,
  );

/**
 * The instructions that precede every conversation. Memories are rendered here
 * rather than injected as fake user turns, so the model can tell what it was
 * told about the person from what the person actually said.
 */
export const buildSystemPrompt = (
  actor: AuthenticatedUser,
  memories: MemoryDocument[],
  now: Date = new Date(),
): string => {
  const lines = [
    'You are Hadiya, the assistant inside a retail business management system.',
    `You are speaking with ${actor.fullName} (role: ${actor.role}).`,
    'Answer in the language the user writes in.',
    'Use your tools when a stored preference or a saved fact could change the answer.',
    'Never store passwords, API keys, card numbers or other credentials in memory.',
    '',
    // Without this the model has no idea what "tomorrow" is and will invent a
    // date. Both the local reading and the zone are given, because a reminder
    // is set in the user's wall clock and never in UTC.
    `The current time for this user is ${formatInTimeZone(now, actor.timezone)}.`,
    `Their time zone is ${actor.timezone}; give every reminder time as their local wall clock, and never convert to UTC yourself.`,
    'If a requested time is vague, ask for an exact one rather than guessing.',
    // Content work is where a model is most tempted to invent a product or a
    // price, and where the tools it needs are least obvious from the request.
    'For content work, base posts on real products and figures: read them with billz_get_products or billz_get_sales_summary first and pass what you found as businessContext. Never invent a product, a price or a discount.',
  ];

  if (memories.length > 0) {
    lines.push('', 'What you remember about this user:');

    for (const memory of memories) {
      lines.push(`- [${memory.type}] ${memory.key}: ${memory.value}`);
    }
  }

  return lines.join('\n');
};

const toPromptMessage = (message: MessageDocument): AiPromptMessage => ({
  role: message.role,
  content: message.content,
  ...(message.toolCallId ? { toolCallId: message.toolCallId } : {}),
  ...(message.toolCalls.length > 0
    ? {
        toolCalls: message.toolCalls.map((call) => ({
          callId: call.callId,
          name: call.name,
          arguments: call.arguments,
        })),
      }
    : {}),
});

/**
 * Keeps a replayed thread self-consistent.
 *
 * Providers require every tool request in a prompt to be answered by a matching
 * tool result, and every result to answer a request that is present. A window
 * that starts or ends mid-exchange breaks that, and the provider rejects the
 * whole call — so an unmatched request has its tool calls stripped and an
 * orphaned result is dropped. The text of both turns is kept: it is still what
 * was said.
 */
const dropUnmatchedToolCalls = (messages: AiPromptMessage[]): AiPromptMessage[] => {
  const answeredCallIds = new Set(
    messages.filter((message) => message.role === 'tool').map((message) => message.toolCallId),
  );
  const requestedCallIds = new Set(
    messages.flatMap((message) => (message.toolCalls ?? []).map((call) => call.callId)),
  );

  return messages.flatMap((message) => {
    if (message.role === 'tool') {
      return requestedCallIds.has(message.toolCallId ?? '') ? [message] : [];
    }

    if (!message.toolCalls || message.toolCalls.length === 0) {
      return [message];
    }

    const answered = message.toolCalls.filter((call) => answeredCallIds.has(call.callId));

    if (answered.length === message.toolCalls.length) {
      return [message];
    }

    const { toolCalls: _dropped, ...rest } = message;

    return answered.length > 0 ? [{ ...rest, toolCalls: answered }] : [rest];
  });
};

/**
 * Trims from the oldest end until the window fits.
 *
 * Dropping the oldest turns keeps the thread coherent — the most recent
 * exchange is the one being answered — and a tool result is dropped with the
 * assistant turn that asked for it, so the transcript never shows an answer to
 * a question the model can no longer see.
 */
const fitToBudget = (
  messages: AiPromptMessage[],
  budget: number,
): { kept: AiPromptMessage[]; dropped: number } => {
  let used = messages.reduce((total, message) => total + message.content.length, 0);
  let start = 0;

  while (used > budget && start < messages.length - 1) {
    used -= messages[start]?.content.length ?? 0;
    start += 1;

    // Never begin the window on an orphaned tool result.
    while (start < messages.length - 1 && messages[start]?.role === 'tool') {
      used -= messages[start]?.content.length ?? 0;
      start += 1;
    }
  }

  return { kept: messages.slice(start), dropped: start };
};

export interface BuildContextInput {
  conversationId: string;
  /** The turn being answered; also the query memories are matched against. */
  userMessage: string;
  recentMessageLimit?: number;
  memoryLimit?: number;
  /** Injected so a test can assert on the time the model was told. */
  now?: Date;
}

export const buildContext = async (
  actor: AuthenticatedUser,
  input: BuildContextInput,
): Promise<BuiltContext> => {
  const [history, scoredMemories] = await Promise.all([
    conversationService.listRecentMessages(
      actor,
      input.conversationId,
      input.recentMessageLimit ?? RECENT_MESSAGE_LIMIT,
    ),
    getMemoryRetriever().retrieve(
      actor,
      input.userMessage,
      input.memoryLimit ?? MEMORY_CONTEXT_LIMIT,
    ),
  ]);

  const memories = scoredMemories.map((entry) => entry.memory);
  const systemPrompt = buildSystemPrompt(actor, memories, input.now);

  // The system prompt is not part of the trimmable window: dropping the
  // instructions to make room for old chatter would be the wrong trade.
  const { kept, dropped } = fitToBudget(
    history.map(toPromptMessage),
    CONTEXT_CHARACTER_BUDGET - systemPrompt.length,
  );

  const messages: AiPromptMessage[] = [
    { role: 'system', content: systemPrompt },
    ...dropUnmatchedToolCalls(kept),
  ];

  return {
    messages,
    memories,
    summary: {
      messageCount: kept.length,
      memoryCount: memories.length,
      truncatedMessageCount: dropped,
      estimatedTokens: estimateTokens(messages),
    },
  };
};
