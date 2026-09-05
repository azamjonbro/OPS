import { randomUUID } from 'node:crypto';

import {
  AGENT_LIMITS,
  type AgentEvent,
  type AgentRunSummary,
  type AgentState,
  type AgentStep,
  type AuthenticatedUser,
  type ChatResponse,
  type PendingActionSummary,
} from '@hadiya/shared';

import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/http/api-error.js';
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
import { buildActorToolRegistry, type ToolRegistry } from '../tools/index.js';
import { NATIVE_PROVENANCE } from '../tools/tool-registry.js';
import { registerRun, releaseRun } from './agent-cancellation.js';
import * as runRegistry from './agent-run-registry.js';
import { createEventSink, type AgentEventSink } from './agent-events.js';
import { screenConfirmation } from './confirmation-gate.js';
import * as pendingActions from './pending-action.service.js';
import { runToolBatch, type ScheduledCall, type ToolOutcome } from './tool-scheduler.js';

const log = createLogger('ai-agent');

/**
 * How many times the model may ask for tools and be called again.
 *
 * Kept as an export because it is the number the agent's behaviour is most
 * often reasoned about by, but it is no longer a constant the loop reads: the
 * limit comes from configuration, and a caller may pin it. What has not changed
 * is what happens at the end of it — the model is asked once more with the
 * results and no tools, so a person always gets a written answer rather than a
 * timeout.
 */
export const MAX_TOOL_ROUNDS = AGENT_LIMITS.maxToolRounds;

/** Everything one run is allowed to spend. */
export type AgentLimitOverrides = Partial<{
  maxToolRounds: number;
  maxModelCalls: number;
  maxParallelTools: number;
  toolTimeoutMs: number;
  maxToolRetries: number;
  retryBackoffMs: number;
  tokenBudget: number;
}>;

export interface AgentDependencies {
  provider?: AiProvider;
  registry?: ToolRegistry;
  /**
   * The id this run will be known by.
   *
   * Supplied by a caller that has to be watching before the run exists — the
   * streaming endpoint opens its socket and starts listening for this id
   * *before* the first event, which is the only way the opening events of a
   * run cannot be lost to a race. Omitted everywhere else, and then it is a
   * fresh UUID as it always was.
   */
  runId?: string;
  /**
   * Whether to ask the provider for the answer as it is written.
   *
   * Off unless somebody is actually watching. Token deltas exist to be
   * rendered; asking for them when nothing is subscribed buys a second
   * transport path and a different set of provider behaviours in exchange for
   * text that is assembled and discarded. The streaming endpoint turns it on,
   * and everything else — a scheduled turn, a script, a test — takes the plain
   * path it always did.
   */
  streamDeltas?: boolean;
  /** Narrows the run's budget. Anything omitted comes from configuration. */
  limits?: AgentLimitOverrides;
  /** Ties tool calls and log lines back to the HTTP request that caused them. */
  requestId?: string;
  /** An extra reason to stop, on top of the run's own cancellation handle. */
  signal?: AbortSignal;
  /** Overrides the deployment's confirmation policy. Tests pin it. */
  requirePendingConfirmation?: boolean;
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
  onDelta?: (delta: string) => void,
): Promise<AiCompletion> => {
  try {
    // Streamed when the provider can and somebody is listening, and identical
    // in every other respect: the same request, the same completion back. A
    // provider that cannot stream is not worked around and its text is not
    // chopped up to look as though it were — the words simply arrive at the
    // end, which is what actually happened.
    if (onDelta && provider.supportsStreaming && provider.stream) {
      return await provider.stream(request, (chunk) => {
        if (chunk.delta.length > 0) {
          onDelta(chunk.delta);
        }
      });
    }

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

const resolveLimits = (overrides: AgentLimitOverrides = {}) => ({
  maxToolRounds: overrides.maxToolRounds ?? config.agent.maxToolRounds,
  maxModelCalls: overrides.maxModelCalls ?? config.agent.maxModelCalls,
  maxParallelTools: overrides.maxParallelTools ?? config.agent.maxParallelTools,
  toolTimeoutMs: overrides.toolTimeoutMs ?? config.agent.toolTimeoutMs,
  maxToolRetries: overrides.maxToolRetries ?? config.agent.maxToolRetries,
  retryBackoffMs: overrides.retryBackoffMs ?? config.agent.retryBackoffMs,
  tokenBudget: overrides.tokenBudget ?? config.agent.tokenBudget,
});

const tokensOf = (completion: AiCompletion): number =>
  (completion.usage.promptTokens ?? 0) + (completion.usage.completionTokens ?? 0);

/**
 * What the model is told about actions still waiting on the person.
 *
 * Without this, a run that resumes has no idea what "ha" refers to: the tool
 * result in the history says a confirmation was needed, but the model is as
 * likely to re-propose from scratch — with new arguments, which the gate will
 * then refuse — as to continue. Naming the outstanding proposal is what makes
 * "continue the pending workflow" a mechanism rather than a hope.
 */
const pendingActionsNote = (actions: PendingActionSummary[]): string =>
  [
    'There are actions in this conversation that you proposed and that are still waiting on the user:',
    ...actions.map((action) => `- ${action.description} (tool: ${action.tool})`),
    'If the user has just agreed, continue that exact action: call the same tool with the same arguments plus confirm: true. Do not change the arguments, and do not start something unrelated.',
    'If the user declined, say so plainly and do not call the tool.',
  ].join('\n');

/**
 * The ledger the model is shown before it writes its closing answer.
 *
 * The single most damaging thing a multi-step agent can do is report a step it
 * did not complete. A model that ran five tools and had one fail is working
 * from five tool results and its own summary of them, and "saved to Notion" is
 * a very easy sentence to write. So the last prompt carries an account that
 * Hadiya generated from what the tools actually returned, not from anything the
 * model said, and instructs it to answer from that.
 */
const outcomeLedgerNote = (steps: AgentStep[]): string => {
  const describe = (step: AgentStep): string => {
    switch (step.outcome) {
      case 'succeeded':
        return `- ${step.tool}: succeeded`;
      case 'needs_confirmation':
        return `- ${step.tool}: NOT done, it is waiting for the user to agree`;
      case 'skipped':
        return `- ${step.tool}: NOT done, it was skipped (${step.error ?? 'a step it needed did not succeed'})`;
      case 'timed_out':
        return `- ${step.tool}: NOT done, it timed out`;
      case 'cancelled':
        return `- ${step.tool}: NOT done, the run was cancelled`;
      default:
        return `- ${step.tool}: FAILED (${step.error ?? 'no reason given'})`;
    }
  };

  return [
    'This is Hadiya’s own record of what the tools in this turn actually did. It is authoritative; your memory of the conversation is not.',
    ...steps.map(describe),
    'Write the final answer from this record. State plainly which parts were done and which were not. Never say something succeeded when this record says it did not, and never invent a result for a step that failed, timed out or was skipped.',
  ].join('\n');
};

/**
 * The longest tool result the transcript will hold.
 *
 * Matches the message schema's own limit, and is applied here rather than left
 * to Mongoose because the alternative is a validation error that fails the
 * whole turn: a tool that answered with sixty thousand characters would take
 * down the reply, the question and every other step with it. Cutting it short
 * loses the tail of one result; not cutting it loses everything.
 *
 * The same text goes to the model, so what a person sees in the transcript is
 * exactly what the model was working from.
 */
const TOOL_RESULT_LIMIT = 4_000;

const TRUNCATION_NOTICE =
  '\n[... the result was longer than Hadiya passes on and was cut short here. Ask a narrower question if you need the rest.]';

const clampResult = (summary: string): string =>
  summary.length <= TOOL_RESULT_LIMIT
    ? summary
    : `${summary.slice(0, TOOL_RESULT_LIMIT - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`;

const toStep = (outcome: ToolOutcome, round: number): AgentStep => ({
  callId: outcome.callId,
  tool: outcome.name,
  round,
  outcome: outcome.outcome,
  risk: outcome.plan?.risk ?? 'write',
  category: outcome.plan?.category ?? 'other',
  provenance: outcome.plan?.provenance ?? NATIVE_PROVENANCE,
  durationMs: outcome.durationMs,
  attempts: outcome.attempts,
  error: outcome.error,
});

/**
 * Runs the tools of one round, having first checked every claimed agreement.
 *
 * The check happens before the scheduler rather than inside it, because a call
 * whose confirmation does not hold must never reach the tool at all — not even
 * to be aborted a moment later. What comes back is a refusal in the shape of a
 * tool result, which is what the model needs to see so it can ask again.
 */
const runRound = async (
  calls: ScheduledCall[],
  options: {
    actor: AuthenticatedUser;
    conversationId: string;
    registry: ToolRegistry;
    workflowId: string;
    requestId: string;
    round: number;
    signal: AbortSignal;
    events: AgentEventSink;
    limits: ReturnType<typeof resolveLimits>;
    ledger: Map<string, ToolOutcome>;
    requirePendingConfirmation?: boolean | undefined;
  },
): Promise<ToolOutcome[]> => {
  const refusals = new Map<string, ToolOutcome>();
  const runnable: ScheduledCall[] = [];

  for (const call of calls) {
    const verdict = await screenConfirmation({
      actor: options.actor,
      conversationId: options.conversationId,
      registry: options.registry,
      call,
      ...(options.requirePendingConfirmation === undefined
        ? {}
        : { requirePendingAction: options.requirePendingConfirmation }),
    });

    if (verdict.kind === 'refuse') {
      options.events.emit('tool.skipped', { tool: call.name, reason: 'confirmation_invalid' });

      refusals.set(call.callId, {
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
        status: 'needs_confirmation',
        outcome: 'needs_confirmation',
        result: { summary: verdict.message, data: { needsConfirmation: true, tool: call.name } },
        durationMs: 0,
        attempts: 0,
        plan: options.registry.plan(call.name) ?? null,
        error: null,
      });

      continue;
    }

    runnable.push(call);
  }

  const executed = await runToolBatch(runnable, {
    registry: options.registry,
    actor: options.actor,
    conversationId: options.conversationId,
    workflowId: options.workflowId,
    requestId: options.requestId,
    round: options.round,
    signal: options.signal,
    events: options.events,
    limits: options.limits,
    ledger: options.ledger,
  });

  const byId = new Map(executed.map((outcome) => [outcome.callId, outcome]));

  return calls.flatMap((call) => {
    const outcome = refusals.get(call.callId) ?? byId.get(call.callId);

    return outcome ? [outcome] : [];
  });
};

/**
 * One turn of the assistant, as a workflow.
 *
 * The shape is the same as it has always been — resolve the conversation, store
 * what the user said, build a bounded context, ask the model, run what it asks
 * for, store every step — and the user's message is still persisted *before*
 * the model is called, so a provider outage loses the reply but never the
 * question.
 *
 * What Phase 11 adds is everything between "the model asked for tools" and "the
 * results came back": several rounds instead of one, calls that may run beside
 * one another when that is safe, deadlines and bounded retries on each, a
 * server-side record of anything waiting on a person's agreement, and a run
 * that can be cancelled while it is going. None of it is visible to a tool: the
 * registry is the same registry, and a Billz capability, a Notion read and
 * somebody's own MCP server are all reached the same way.
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
  // Built per turn rather than taken from a singleton: the built-in tools are
  // everyone's, but the connected integrations are this account's alone, and a
  // shared registry would hand one person's MCP servers to the next caller.
  const registry = dependencies.registry ?? (await buildActorToolRegistry(actor));
  const limits = resolveLimits(dependencies.limits);

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

  // Built before the run is registered, so a context that cannot be assembled
  // does not leave a cancellation handle behind with nothing to cancel.
  const context = await buildContext(actor, { conversationId, userMessage: input.message });
  const usedMemories = context.memories;

  // Reading a memory counts as using it, which later feeds relevance ordering.
  await memoryService.markMemoriesUsed(
    actor,
    usedMemories.map((memory) => String(memory._id)),
  );

  const workflowId = dependencies.runId ?? randomUUID();
  const requestId = dependencies.requestId ?? workflowId;
  const runSignal = registerRun({ workflowId, conversationId, userId: actor.id });
  // A caller may bring its own reason to stop — a closed HTTP connection, a
  // parent workflow — and both have to be able to end this one.
  const signal = dependencies.signal
    ? AbortSignal.any([runSignal, dependencies.signal])
    : runSignal;

  // Opened before the first event, so nothing a watcher needs is emitted into
  // a run the registry has not heard of yet.
  runRegistry.openRun({ runId: workflowId, conversationId, userId: actor.id });

  const events = createEventSink({ workflowId, conversationId, userId: actor.id });
  const steps: AgentStep[] = [];
  const ledger = new Map<string, ToolOutcome>();

  let state: AgentState = 'planning';
  let assistantMessage: MessageDocument | null = null;
  let modelCalls = 0;
  let rounds = 0;
  let tokensSpent = 0;
  let limitReached = false;

  events.emit('agent.started', {
    tools: registry.list().length,
    maxToolRounds: limits.maxToolRounds,
    maxModelCalls: limits.maxModelCalls,
  });

  try {
    const promptMessages: AiPromptMessage[] = [...context.messages];

    // Anything this conversation is already waiting on is named for the model
    // before it plans, so an answer of "ha" resumes that action rather than
    // starting a new one.
    const alreadyWaiting = await pendingActions.listPendingActions(actor, conversationId);

    if (alreadyWaiting.length > 0) {
      promptMessages.push({
        role: 'system',
        content: pendingActionsNote(alreadyWaiting.map(pendingActions.toPendingActionSummary)),
      });
    }

    for (let round = 0; round <= limits.maxToolRounds; round += 1) {
      if (signal.aborted) {
        state = 'cancelled';
        break;
      }

      // One completion is always held back for the written answer, so a run
      // that spends its budget still ends in a sentence rather than in silence.
      const withholdTools =
        round >= limits.maxToolRounds ||
        modelCalls + 1 >= limits.maxModelCalls ||
        tokensSpent >= limits.tokenBudget;

      state = 'planning';
      events.emit('agent.thinking', {
        round,
        toolsOffered: withholdTools ? 0 : registry.list().length,
        tokensSpent,
      });

      const request: AiCompletionRequest = {
        // Once anything has run, every subsequent call carries Hadiya's own
        // account of it. Not only the closing one: the model may answer at any
        // round, and the round it chooses is not something the loop gets to
        // know in advance.
        messages:
          steps.length > 0
            ? [...promptMessages, { role: 'system', content: outcomeLedgerNote(steps) }]
            : promptMessages,
        // On the closing round the tools are withheld, which forces a written
        // answer instead of another request Hadiya would only have to refuse.
        tools: withholdTools ? [] : registry.definitions(),
      };

      // One id per completion. The browser appends deltas to the message it
      // names and closes that one, so a round that produced text before asking
      // for a tool cannot bleed into the round after it.
      const messageId = `${workflowId}:${round}`;
      let streamedAnything = false;

      const completion = await complete(
        provider,
        request,
        dependencies.streamDeltas
          ? (delta) => {
              streamedAnything = true;
              events.emit('assistant.delta', { messageId, delta });
            }
          : undefined,
      );

      if (streamedAnything) {
        events.emit('assistant.completed', { messageId });
      }

      modelCalls += 1;
      tokensSpent += tokensOf(completion);

      if (completion.toolCalls.length === 0 || withholdTools) {
        limitReached = limitReached || (withholdTools && completion.toolCalls.length > 0);

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

        state = 'completed';

        break;
      }

      rounds += 1;
      state = 'executing';

      const outcomes = await runRound(
        completion.toolCalls.map((call) => ({
          callId: call.callId,
          name: call.name,
          arguments: call.arguments,
        })),
        {
          actor,
          conversationId,
          registry,
          workflowId,
          requestId,
          round,
          signal,
          events,
          limits,
          ledger,
          requirePendingConfirmation: dependencies.requirePendingConfirmation,
        },
      );

      const roundCalls: MessageToolCallSubdocument[] = outcomes.map((outcome) => ({
        callId: outcome.callId,
        name: outcome.name,
        arguments: outcome.arguments,
        status: outcome.status,
        result: clampResult(outcome.result.summary),
        // Only the summary goes back to the model; the structured payload is
        // stored alongside it so the chat can render what the tool produced.
        data: outcome.result.data ?? null,
        durationMs: outcome.durationMs,
      }));

      for (const outcome of outcomes) {
        steps.push(toStep(outcome, round));

        // Everything the person is being asked about is written down before the
        // question is put to them, so the agreement can be checked against what
        // was actually proposed rather than against what the model remembers.
        if (outcome.confirmation) {
          const plan = outcome.plan;

          const proposal = await pendingActions.recordPendingAction(actor, {
            conversationId,
            workflowId,
            requestedCallId: outcome.callId,
            tool: outcome.name,
            args: outcome.confirmation.args,
            description: outcome.confirmation.description,
            integrationId: plan?.provenance.integrationId ?? null,
            integrationName: plan?.provenance.integrationName ?? null,
          });

          // Emitted here rather than in the scheduler, because only here does
          // the proposal have an id and an expiry — and a confirmation card
          // without those is one a person could answer after it had lapsed.
          // The description is the tool's own words about the real target; the
          // arguments behind it stay on the server.
          events.emit('confirmation.required', {
            callId: outcome.callId,
            pendingActionId: String(proposal._id),
            tool: outcome.name,
            displayName: plan?.display.displayName ?? outcome.name,
            runningLabel: plan?.display.runningLabel ?? outcome.name,
            doneLabel: plan?.display.doneLabel ?? outcome.name,
            category: plan?.category ?? 'other',
            risk: plan?.risk ?? 'write',
            integration: plan?.provenance.integrationName ?? null,
            title: plan?.display.displayName ?? outcome.name,
            description: outcome.confirmation.description,
            expiresAt: proposal.expiresAt.toISOString(),
          });
        }
      }

      if (outcomes.some((outcome) => outcome.status === 'failed')) {
        // Something went wrong and the run is carrying on with what did work.
        state = 'recovering';
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

    if (signal.aborted) {
      state = 'cancelled';
    }

    if (state === 'cancelled') {
      // A cancelled run leaves the conversation honest rather than empty: the
      // question stays, what did run stays, and the transcript says plainly
      // that the rest was stopped. Anything still waiting on agreement is
      // withdrawn, so a later "ha" cannot revive it.
      await pendingActions.cancelPendingActions(actor, conversationId);

      assistantMessage ??= await conversationService.appendMessage(actor, {
        conversationId,
        role: 'assistant',
        content: 'Bekor qilindi.',
        toolCalls: [],
      });

      events.emit('agent.cancelled', { rounds, steps: steps.length });
    } else if (!assistantMessage) {
      throw new Error('The assistant produced no reply');
    }
  } catch (error) {
    // `ApiError` messages are written for a person and carry no upstream body;
    // anything else is reported in general terms rather than by leaking the
    // text of a bug.
    const message =
      error instanceof ApiError ? error.message : 'The assistant could not finish that.';

    events.emit('agent.failed', {
      rounds,
      modelCalls,
      reason: error instanceof Error ? error.name : 'unknown',
      message,
    });

    runRegistry.failRun(workflowId, {
      code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
      message,
    });

    log.warn({ user: actor.id, workflow: workflowId, err: error }, 'agent run failed');

    throw error;
  } finally {
    releaseRun(workflowId);
  }

  // What the conversation is still waiting on decides the state, rather than
  // whatever the last round happened to set. A turn that proposed something and
  // was answered ends `completed`; one that proposed something and is still
  // waiting says so — read from the stored proposals rather than inferred from
  // the model's behaviour.
  const outstanding =
    state === 'cancelled' ? [] : await pendingActions.listPendingActions(actor, conversationId);

  if (outstanding.length > 0) {
    state = 'waiting_for_confirmation';
  }

  if (state !== 'cancelled') {
    events.emit('agent.completed', {
      state,
      rounds,
      modelCalls,
      steps: steps.length,
      tokensSpent,
      limitReached,
    });
  }

  // Anything the assistant wanted to remember but was not sure enough about is
  // surfaced so the client can ask, rather than being kept silently.
  const { items: pending } = await memoryService.listMemories(actor, {
    page: 1,
    pageSize: 10,
    status: 'pending',
  });

  const summary: AgentRunSummary = {
    workflowId,
    state,
    rounds,
    modelCalls,
    steps,
    events: [...events.events] as AgentEvent[],
    pendingActions: outstanding.map(pendingActions.toPendingActionSummary),
    limitReached,
    tokensSpent,
  };

  log.info(
    {
      user: actor.id,
      conversation: conversationId,
      workflow: workflowId,
      state,
      rounds,
      modelCalls,
      tools: steps.length,
      // Retries and failures are what an on-call reader is actually looking
      // for; the arguments and results that would explain them are deliberately
      // not here.
      retried: steps.filter((step) => step.attempts > 1).length,
      failed: steps.filter((step) => step.outcome !== 'succeeded').length,
      tokensSpent,
      limitReached,
    },
    'agent run finished',
  );

  const response: ChatResponse = {
    conversationId,
    message: assistantMessage as unknown as ChatResponse['message'],
    usedMemories: usedMemories.map(toMemorySummary),
    pendingMemories: pending.map(toMemorySummary),
    agent: summary,
  };

  // The same object the caller is about to receive. A client that watched the
  // run and one that waited for the POST therefore end up holding exactly the
  // same turn, rather than a thin streamed version and a full one.
  runRegistry.closeRun(workflowId, { response, summary });

  return response;
};
