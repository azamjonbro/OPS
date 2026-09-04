import type { AuthenticatedUser, ChatResponse } from '@hadiya/shared';

import { createLogger } from '../../../core/logger/logger.js';
import * as conversationService from '../../conversations/conversation.service.js';
import type {
  MessageDocument,
  MessageToolCallSubdocument,
} from '../../conversations/message.model.js';
import type { MemoryDocument } from '../../memory/memory.model.js';
import * as memoryService from '../../memory/memory.service.js';
import { buildContext } from '../context/context-builder.service.js';
import {
  getAiProvider,
  isAiProviderError,
  type AiCompletion,
  type AiCompletionRequest,
  type AiPromptMessage,
  type AiProvider,
} from '../provider/index.js';
import { getToolRegistry, type ToolRegistry } from '../tools/index.js';

const log = createLogger('ai-agent');

/**
 * How many times the model may ask for tools and be called again.
 *
 * A model that keeps requesting tools would otherwise loop forever; after the
 * limit it is asked once more with the results and no tools, so the user
 * always gets a written answer rather than a timeout.
 */
export const MAX_TOOL_ROUNDS = 3;

export interface AgentDependencies {
  provider?: AiProvider;
  registry?: ToolRegistry;
}

export interface SendMessageInput {
  /** Omit to open a new conversation, titled from this first message. */
  conversationId?: string | undefined;
  message: string;
}

/**
 * Every model call goes through here, so a provider failure is translated once.
 *
 * `AiProviderError` knows which HTTP answer it deserves — a rejected key is a
 * `503`, a rate limit a `429` — and nothing it carries reaches the client, so
 * a provider outage can never surface as an unhandled 500 or leak a credential.
 */
const complete = async (
  provider: AiProvider,
  request: AiCompletionRequest,
): Promise<AiCompletion> => {
  try {
    return await provider.complete(request);
  } catch (error) {
    if (isAiProviderError(error)) {
      throw error.toApiError();
    }

    throw error;
  }
};

const toMemorySummary = (memory: MemoryDocument): ChatResponse['usedMemories'][number] => ({
  id: String(memory._id),
  type: memory.type,
  key: memory.key,
  value: memory.value,
});

/**
 * One turn of the assistant.
 *
 * The sequence is fixed and deliberate: resolve the conversation, store what
 * the user said, build a bounded context from history and memory, ask the
 * model, run any tools it asked for through the registry, and store every step.
 * The user's message is persisted *before* the model is called, so a provider
 * outage loses the reply but never the question.
 *
 * The actor comes from the authenticated request and is passed to every call
 * below, so a conversation, a memory and a tool all act as the same person.
 */
export const sendMessage = async (
  actor: AuthenticatedUser,
  input: SendMessageInput,
  dependencies: AgentDependencies = {},
): Promise<ChatResponse> => {
  const provider = dependencies.provider ?? getAiProvider();
  const registry = dependencies.registry ?? getToolRegistry();

  const conversation = input.conversationId
    ? await conversationService.getConversation(actor, input.conversationId)
    : await conversationService.createConversation(actor, {
        title: conversationService.deriveTitle(input.message),
      });

  const conversationId = String(conversation._id);

  await conversationService.appendMessage(actor, {
    conversationId,
    role: 'user',
    content: input.message,
  });

  const context = await buildContext(actor, { conversationId, userMessage: input.message });

  // Reading a memory counts as using it, which later feeds relevance ordering.
  await memoryService.markMemoriesUsed(
    actor,
    context.memories.map((memory) => String(memory._id)),
  );

  const promptMessages: AiPromptMessage[] = [...context.messages];
  let assistantMessage: MessageDocument | null = null;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const isFinalRound = round === MAX_TOOL_ROUNDS;
    const completion = await complete(provider, {
      messages: promptMessages,
      // On the last round the tools are withheld, which forces a written answer.
      tools: isFinalRound ? [] : registry.definitions(),
    });

    if (completion.toolCalls.length === 0 || isFinalRound) {
      assistantMessage = await conversationService.appendMessage(actor, {
        conversationId,
        role: 'assistant',
        content: completion.content,
        // Deliberately empty: each round already stored its own calls on its
        // own turn. Repeating them here would make the closing message look
        // like an unanswered tool request when the thread is replayed.
        toolCalls: [],
        model: completion.model,
        usage: completion.usage,
      });
      break;
    }

    const roundCalls: MessageToolCallSubdocument[] = [];

    for (const call of completion.toolCalls) {
      const outcome = await registry.execute(call.name, call.arguments, {
        actor,
        conversationId,
      });

      roundCalls.push({
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
        status: outcome.status,
        result: outcome.result.summary,
        durationMs: outcome.durationMs,
      });

      log.debug({ tool: call.name, status: outcome.status }, 'tool call completed');
    }

    // The assistant's request and each result are recorded as their own turns,
    // so the transcript replays exactly what the model saw.
    await conversationService.appendMessage(actor, {
      conversationId,
      role: 'assistant',
      content: completion.content,
      toolCalls: roundCalls,
      model: completion.model,
      usage: completion.usage,
    });

    promptMessages.push({
      role: 'assistant',
      content: completion.content,
      toolCalls: completion.toolCalls,
    });

    for (const call of roundCalls) {
      await conversationService.appendMessage(actor, {
        conversationId,
        role: 'tool',
        content: call.result ?? '',
        toolCallId: call.callId,
      });

      promptMessages.push({
        role: 'tool',
        content: call.result ?? '',
        toolCallId: call.callId,
      });
    }
  }

  if (!assistantMessage) {
    throw new Error('The assistant produced no reply');
  }

  // Anything the assistant wanted to remember but was not sure enough about is
  // surfaced so the client can ask, rather than being kept silently.
  const { items: pending } = await memoryService.listMemories(actor, {
    page: 1,
    pageSize: 10,
    status: 'pending',
  });

  return {
    conversationId,
    message: assistantMessage as unknown as ChatResponse['message'],
    usedMemories: context.memories.map(toMemorySummary),
    pendingMemories: pending.map(toMemorySummary),
  };
};
