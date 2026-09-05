import { createHash } from 'node:crypto';

import type { AgentStepOutcome, AuthenticatedUser, ToolCallStatus } from '@hadiya/shared';

import { createLogger } from '../../../core/logger/logger.js';
import {
  ToolRegistry,
  type RegisteredTool,
  type ToolContext,
  type ToolPlan,
  type ToolResult,
} from '../tools/tool-registry.js';
import type { AgentEventSink } from './agent-events.js';
import {
  backoffFor,
  classifyFailure,
  shouldRetry,
  sleep,
  ToolCancelledError,
  ToolTimeoutError,
} from './tool-retry.js';

const log = createLogger('agent-scheduler');

/**
 * Running the tools one round of the model asked for.
 *
 * The model produces a flat list of calls and no ordering beyond the order it
 * wrote them in. Turning that into execution is where most of this phase's
 * judgement lives, and it comes down to four questions asked of every call:
 *
 *  1. **May it run beside its neighbours?** Three reads of three different
 *     services have no reason to queue behind one another, and a shopkeeper
 *     asking for today's sales, expenses and debts should wait once rather than
 *     three times. Two writes might conflict, so they do not.
 *  2. **Is what it needs actually there?** A tool that declares a dependency on
 *     another in the same round does not run when that one failed. There is no
 *     placeholder result and no empty object standing in for one: an invented
 *     input is worse than a missing step, because the model cannot see that it
 *     was invented.
 *  3. **How long may it take?** Every call has a deadline. One unresponsive MCP
 *     server stalls its own call and nothing else.
 *  4. **If it failed, would trying again help?** Bounded, backed off, and never
 *     for a write that is not safe to repeat.
 *
 * Order is preserved in the results whatever order they ran in, so the
 * transcript reads the way the model asked rather than the way the network
 * happened to answer.
 */

export interface ScheduledCall {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** What the scheduler decided about one call, and what came of it. */
export interface ToolOutcome {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  /** As the transcript records it. */
  status: ToolCallStatus;
  /** One level finer, for the run summary: a skip is not a failure. */
  outcome: AgentStepOutcome;
  result: ToolResult;
  durationMs: number;
  /** Including the first. Above one means something was retried. */
  attempts: number;
  plan: ToolPlan | null;
  /** Written for a person; null when nothing went wrong. */
  error: string | null;
  /** Present when the call stopped to ask. Carries the validated arguments. */
  confirmation?: { description: string; args: Record<string, unknown> };
}

export interface SchedulerLimits {
  maxParallelTools: number;
  toolTimeoutMs: number;
  maxToolRetries: number;
  retryBackoffMs: number;
}

export interface SchedulerOptions {
  registry: ToolRegistry;
  actor: AuthenticatedUser;
  conversationId: string;
  workflowId: string;
  requestId: string;
  round: number;
  signal: AbortSignal;
  events: AgentEventSink;
  limits: SchedulerLimits;
  /**
   * Writes already made in this run, keyed by tool and arguments.
   *
   * Lives on the run rather than on the round because a model that asked for
   * the same invoice twice, two rounds apart, meant it no more the second time
   * than the first. Shared by reference so the ledger accumulates across rounds.
   */
  ledger: Map<string, ToolOutcome>;
}

/** A digest of what a call would do, stable across attempts and rounds. */
const callFingerprint = (name: string, args: Record<string, unknown>): string =>
  createHash('sha256')
    .update(name)
    .update(' ')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(args)
            .filter(([key]) => key !== 'confirm')
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
      ),
    )
    .digest('hex');

const failureOutcome = (
  call: ScheduledCall,
  plan: ToolPlan | null,
  message: string,
  options: { outcome?: AgentStepOutcome; durationMs?: number; attempts?: number } = {},
): ToolOutcome => ({
  callId: call.callId,
  name: call.name,
  arguments: call.arguments,
  status: 'failed',
  outcome: options.outcome ?? 'failed',
  result: { summary: message },
  durationMs: options.durationMs ?? 0,
  attempts: options.attempts ?? 0,
  plan,
  error: message,
});

/**
 * Splits one round's calls into waves that may run together.
 *
 * A greedy pass in the model's own order, which keeps two properties worth
 * having: a call never overtakes one written before it, and the common shape
 * (a run of independent reads) collapses into a single wave without anything
 * having to declare that it is independent.
 */
export const planWaves = (
  calls: ScheduledCall[],
  planOf: (name: string) => ToolPlan | undefined,
  maxParallel: number,
): ScheduledCall[][] => {
  const waves: ScheduledCall[][] = [];
  const seenBefore = new Set<string>();
  const resources = new Set<string>();
  let current: ScheduledCall[] = [];

  const close = (): void => {
    if (current.length > 0) {
      waves.push(current);
      current = [];
      resources.clear();
    }
  };

  for (const call of calls) {
    const plan = planOf(call.name);
    // An unknown tool is refused rather than run, but it still gets its own
    // wave: it is cheap, and a wave is not the place to reason about a name
    // nothing is registered under.
    const dependsOnEarlier = plan?.dependsOn.some((name) => seenBefore.has(name)) ?? false;
    const conflicts = plan?.resource ? resources.has(plan.resource) : false;
    const joinable =
      plan !== undefined &&
      plan.parallelSafe &&
      !dependsOnEarlier &&
      !conflicts &&
      current.length < maxParallel;

    if (joinable) {
      current.push(call);

      if (plan.resource) {
        resources.add(plan.resource);
      }
    } else {
      close();
      waves.push([call]);
    }

    seenBefore.add(call.name);
  }

  close();

  return waves;
};

/**
 * One attempt at one call, with a deadline.
 *
 * The deadline is enforced by not waiting any longer, not by killing anything:
 * a tool that ignores its signal goes on running in the background, its result
 * discarded. That is the honest limit of a timeout in this architecture, and it
 * is exactly why a write that timed out is never retried.
 */
const runWithTimeout = async (
  tool: RegisteredTool,
  args: unknown,
  context: ToolContext,
  timeoutMs: number,
  toolName: string,
): Promise<ToolResult> => {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      ToolRegistry.run(tool, args, context),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new ToolTimeoutError(toolName, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** Runs one call to completion, retries included. */
const runOne = async (call: ScheduledCall, options: SchedulerOptions): Promise<ToolOutcome> => {
  const startedAt = Date.now();
  const plan = options.registry.plan(call.name) ?? null;

  if (!plan) {
    options.events.emit('tool.failed', { tool: call.name, reason: 'unknown_tool' });

    return failureOutcome(call, null, `There is no tool named "${call.name}".`);
  }

  if (options.signal.aborted) {
    return failureOutcome(call, plan, 'The run was cancelled before this step started.', {
      outcome: 'cancelled',
    });
  }

  const fingerprint = callFingerprint(call.name, call.arguments);
  const idempotencyKey = createHash('sha256')
    .update(options.workflowId)
    .update(' ')
    .update(fingerprint)
    .digest('hex');

  // A write that is not safe to repeat is done once per run, whatever the model
  // asks. This is the guarantee that survives a repeated round: the second
  // request is answered from what the first actually returned rather than by
  // creating a second invoice.
  if (plan.mutates && !plan.idempotent) {
    const already = options.ledger.get(idempotencyKey);

    if (already && already.status === 'succeeded') {
      options.events.emit('tool.skipped', { tool: call.name, reason: 'already_done' });

      return {
        ...already,
        callId: call.callId,
        outcome: 'skipped',
        durationMs: 0,
        result: {
          summary: `This exact action was already carried out in this workflow and was not repeated. Result: ${already.result.summary}`,
          data: already.result.data,
        },
      };
    }
  }

  const baseContext: ToolContext = {
    actor: options.actor,
    conversationId: options.conversationId,
    workflowId: options.workflowId,
    requestId: options.requestId,
    idempotencyKey,
    attempt: 1,
    signal: options.signal,
  };

  const preflight = await options.registry.preflight(call.name, call.arguments, baseContext);

  if (preflight.kind === 'unknown_tool' || preflight.kind === 'invalid_arguments') {
    options.events.emit('tool.failed', {
      tool: call.name,
      round: options.round,
      reason: preflight.kind,
    });

    return failureOutcome(call, plan, preflight.message, { durationMs: Date.now() - startedAt });
  }

  if (preflight.kind === 'needs_confirmation') {
    options.events.emit('confirmation.required', {
      tool: call.name,
      round: options.round,
      integration: plan.provenance.integrationName,
    });

    return {
      callId: call.callId,
      name: call.name,
      arguments: call.arguments,
      status: 'needs_confirmation',
      outcome: 'needs_confirmation',
      result: {
        summary: `Confirmation needed: ${preflight.description}. Ask the user to confirm, then call "${call.name}" again with confirm: true. Do not assume they agreed.`,
        data: { needsConfirmation: true, tool: call.name },
      },
      durationMs: Date.now() - startedAt,
      attempts: 0,
      plan,
      error: null,
      confirmation: {
        description: preflight.description,
        args: (preflight.args ?? {}) as Record<string, unknown>,
      },
    };
  }

  const timeoutMs = plan.timeoutMs ?? options.limits.toolTimeoutMs;
  let attempt = 0;
  let lastError: unknown;

  while (attempt <= options.limits.maxToolRetries) {
    attempt += 1;

    if (options.signal.aborted) {
      lastError = new ToolCancelledError(call.name);
      break;
    }

    options.events.emit('tool.started', {
      tool: call.name,
      round: options.round,
      attempt,
      risk: plan.risk,
      category: plan.category,
      source: plan.provenance.source,
      integration: plan.provenance.integrationName,
    });

    try {
      const result = await runWithTimeout(
        preflight.tool,
        preflight.args,
        { ...baseContext, attempt },
        timeoutMs,
        call.name,
      );

      const outcome: ToolOutcome = {
        callId: call.callId,
        name: call.name,
        arguments: call.arguments,
        status: 'succeeded',
        outcome: 'succeeded',
        result,
        durationMs: Date.now() - startedAt,
        attempts: attempt,
        plan,
        error: null,
      };

      if (plan.mutates && !plan.idempotent) {
        options.ledger.set(idempotencyKey, outcome);
      }

      options.events.emit('tool.completed', {
        tool: call.name,
        round: options.round,
        attempts: attempt,
        durationMs: outcome.durationMs,
        source: plan.provenance.source,
      });

      return outcome;
    } catch (error) {
      lastError = error;

      const decision = shouldRetry({
        error,
        plan,
        attempt,
        maxRetries: options.limits.maxToolRetries,
      });

      log.warn(
        {
          tool: call.name,
          workflow: options.workflowId,
          attempt,
          kind: decision.kind,
          retry: decision.retry,
          err: error,
        },
        'tool attempt failed',
      );

      if (!decision.retry) {
        break;
      }

      options.events.emit('tool.retrying', {
        tool: call.name,
        round: options.round,
        attempt,
        kind: decision.kind,
      });

      await sleep(backoffFor(attempt, options.limits.retryBackoffMs), options.signal);
    }
  }

  const kind = classifyFailure(lastError);
  const cancelled = lastError instanceof ToolCancelledError || options.signal.aborted;
  const message = lastError instanceof Error ? lastError.message : `The "${call.name}" tool failed.`;

  options.events.emit('tool.failed', {
    tool: call.name,
    round: options.round,
    attempts: attempt,
    kind,
    source: plan.provenance.source,
  });

  return {
    callId: call.callId,
    name: call.name,
    arguments: call.arguments,
    status: 'failed',
    outcome: cancelled ? 'cancelled' : kind === 'timeout' ? 'timed_out' : 'failed',
    result: { summary: message },
    durationMs: Date.now() - startedAt,
    attempts: attempt,
    plan,
    error: message,
  };
};

/**
 * Runs one round's worth of calls and returns their outcomes in the order they
 * were asked for.
 *
 * Nothing here throws. A round that went entirely wrong still produces a result
 * per call, because the model's next turn has to be able to see what happened,
 * and because a person is owed an accurate account of which half worked.
 */
export const runToolBatch = async (
  calls: ScheduledCall[],
  options: SchedulerOptions,
): Promise<ToolOutcome[]> => {
  const results = new Map<string, ToolOutcome>();
  const succeeded = new Set<string>();
  const attempted = new Set<string>();
  const waves = planWaves(
    calls,
    (name) => options.registry.plan(name),
    Math.max(1, options.limits.maxParallelTools),
  );

  for (const wave of waves) {
    if (options.signal.aborted) {
      for (const call of wave) {
        results.set(
          call.callId,
          failureOutcome(call, options.registry.plan(call.name) ?? null, 'The run was cancelled.', {
            outcome: 'cancelled',
          }),
        );
      }

      continue;
    }

    const runnable: ScheduledCall[] = [];

    for (const call of wave) {
      const plan = options.registry.plan(call.name);
      // A dependency only gates when the tool it names was asked for in this
      // same round: across rounds the model has already seen the result, and
      // gating there would refuse a perfectly ordinary follow-up.
      const unmet = (plan?.dependsOn ?? []).filter(
        (name) => attempted.has(name) && !succeeded.has(name),
      );

      if (unmet.length > 0) {
        options.events.emit('tool.skipped', {
          tool: call.name,
          round: options.round,
          reason: 'dependency_failed',
          dependency: unmet[0] ?? null,
        });

        results.set(
          call.callId,
          failureOutcome(
            call,
            plan ?? null,
            `Skipped: "${call.name}" needs the result of "${unmet.join('", "')}", which did not succeed in this step. Nothing was made up to stand in for it.`,
            { outcome: 'skipped' },
          ),
        );

        continue;
      }

      runnable.push(call);
    }

    const outcomes = await Promise.all(runnable.map((call) => runOne(call, options)));

    for (const outcome of outcomes) {
      results.set(outcome.callId, outcome);

      if (outcome.status === 'succeeded') {
        succeeded.add(outcome.name);
      }
    }

    // Recorded after the wave, so a dependency is only ever judged against a
    // call that has actually finished.
    for (const call of wave) {
      attempted.add(call.name);
    }
  }

  return calls.map(
    (call) =>
      results.get(call.callId) ??
      failureOutcome(call, null, `The "${call.name}" call was never run.`, { outcome: 'skipped' }),
  );
};
