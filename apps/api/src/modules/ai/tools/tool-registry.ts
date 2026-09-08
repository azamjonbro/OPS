import {
  type AuthenticatedUser,
  type ToolCategory,
  type ToolDescriptor,
  type ToolProvenance,
  type ToolRisk,
  type ToolCallStatus,
} from '@hadiya/shared';
import { z } from 'zod';

import { createLogger } from '../../../core/logger/logger.js';
import type { AiToolDefinition } from '../provider/ai-provider.js';
import { toolDisplayFor, type ToolDisplayLabels } from './tool-display.js';

const log = createLogger('ai-tools');

/**
 * What a tool is given when it runs.
 *
 * The actor comes from the authenticated request, never from the model, so a
 * tool cannot be talked into acting as somebody else.
 *
 * Everything after `conversationId` is supplied by the orchestrator and is
 * optional here on purpose: a tool called directly — by a test, or by a script
 * — still gets a valid context, and a tool that does not care about the run it
 * belongs to does not have to mention it. What a tool must never receive is a
 * credential; secrets are fetched inside the tool from the credential store,
 * against the actor, and never travel through arguments the model wrote.
 */
export interface ToolContext {
  actor: AuthenticatedUser;
  conversationId: string;
  /** The run this call belongs to. Present whenever the agent is driving. */
  workflowId?: string;
  /** Correlates this call with the HTTP request that caused it, in the logs. */
  requestId?: string;
  /**
   * Stable across retries of the same call and different for every other call.
   *
   * A tool whose upstream API accepts an idempotency key should forward this
   * one, so a retried write cannot become two invoices. Where the upstream has
   * no such notion the key is still useful: the scheduler uses it to refuse to
   * run the same write twice within a run.
   */
  idempotencyKey?: string;
  /** 1 on the first try. Above that, the previous attempt failed transiently. */
  attempt?: number;
  /**
   * Aborted when the run is cancelled or the call runs out of time.
   *
   * A tool that makes a network request should pass this to `fetch`. A tool
   * that ignores it is not left running for ever — the orchestrator stops
   * waiting and records a timeout — but its work does continue in the
   * background, which is why writes are not retried after one.
   */
  signal?: AbortSignal;
}

export interface ToolResult {
  /** Short text handed back to the model as the tool's answer. */
  summary: string;
  /** Structured payload for the API response; never shown to the model raw. */
  data?: unknown;
}

export interface RegisteredTool<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  /** Written for a model: what it does and when to reach for it. */
  description: string;
  schema: TSchema;
  /**
   * Whether the tool changes stored state. Read-only tools can run freely;
   * writing tools are the ones worth auditing.
   */
  mutates: boolean;
  /**
   * Whether the person has to agree before this runs.
   *
   * Reserved for what cannot be undone. Creating is cheap to reverse — delete
   * the thing — but a destroyed plan is gone, and a model that misread
   * "eskisini o'chir" would destroy it on its own reading of the sentence. Such
   * a tool must accept a `confirm` boolean; the registry refuses to run it
   * until that is `true`, so the guard cannot be forgotten inside the tool.
   */
  requiresConfirmation?: boolean;
  /** Roughly what this tool is for. Defaults to `other`. */
  category?: ToolCategory;
  /**
   * How much damage it could do. Defaults to the honest reading of the two
   * flags above: something that asks first is destructive, something that
   * writes is a write, everything else is a read.
   */
  risk?: ToolRisk;
  /**
   * Whether this may run beside other tools in the same round.
   *
   * Defaults to "reads may, writes may not". A read cannot conflict with
   * anything, so running three of them at once is free latency; two writes
   * touching the same thing at once is a race nobody asked for.
   */
  parallelSafe?: boolean;
  /**
   * Whether running it twice with the same arguments is the same as running it
   * once. Defaults to true for reads and false for writes — the conservative
   * reading, because it is what decides whether a failure may be retried.
   */
  idempotent?: boolean;
  /**
   * What this tool writes to, for tools that write.
   *
   * Two calls naming the same resource are never run concurrently. It is a
   * coarse lock and deliberately so: the point is that "update this plan" and
   * "delete this plan" in one round happen in the order the model asked for,
   * not that every write in Hadiya is serialised.
   */
  resource?: string;
  /**
   * Tools whose result this one needs, when both are asked for in the same
   * round.
   *
   * Only ever a gate, never a promise: if a named tool was requested alongside
   * this one and did not succeed, this call is skipped rather than run against
   * a result that does not exist. Across rounds it does nothing — by then the
   * model has seen the result and is asking with it in hand.
   */
  dependsOn?: readonly string[];
  /** Where it came from. Defaults to a native Hadiya tool. */
  provenance?: ToolProvenance;
  /**
   * What to call this on a screen while it runs.
   *
   * Optional because most tools get a sensible phrase from `tool-display.ts`
   * without saying anything. Declaring one here is for a tool whose derived
   * label would read badly, and it is the only thing that overrides the table.
   */
  display?: Partial<ToolDisplayLabels>;
  /** Overrides the run's tool timeout, for something known to be slow. */
  timeoutMs?: number;
  /**
   * What the model should tell the person it is about to do. Runs *before* the
   * action, with the same validated arguments, so the description is of the
   * real target rather than of what the model believed it had selected.
   */
  describeConfirmation?: (
    args: z.output<TSchema>,
    context: ToolContext,
  ) => Promise<string> | string;
  execute: (args: z.output<TSchema>, context: ToolContext) => Promise<ToolResult>;
}

/** Provenance for a tool that is part of Hadiya itself. */
export const NATIVE_PROVENANCE: ToolProvenance = {
  source: 'native',
  integrationId: null,
  integrationName: null,
  externalName: null,
};

/**
 * Everything the orchestrator needs to know about a tool before it runs it,
 * with every default already applied.
 *
 * Resolved in one place so that a tool declaring nothing but `mutates` still
 * gets a coherent classification, and so the rules that derive one field from
 * another are written once rather than at each call site that consults them.
 */
export interface ToolPlan {
  name: string;
  category: ToolCategory;
  risk: ToolRisk;
  mutates: boolean;
  requiresConfirmation: boolean;
  parallelSafe: boolean;
  idempotent: boolean;
  resource: string | null;
  dependsOn: readonly string[];
  provenance: ToolProvenance;
  timeoutMs: number | null;
  /** Already resolved, so an event can carry it without a second lookup. */
  display: ToolDisplayLabels;
}

export const resolveToolPlan = (tool: RegisteredTool): ToolPlan => {
  const requiresConfirmation = tool.requiresConfirmation ?? false;
  const risk =
    tool.risk ?? (requiresConfirmation ? 'destructive' : tool.mutates ? 'write' : 'read');
  const category = tool.category ?? 'other';
  const provenance = tool.provenance ?? NATIVE_PROVENANCE;

  return {
    name: tool.name,
    category,
    risk,
    mutates: tool.mutates,
    requiresConfirmation,
    // A tool that needs agreeing to is never run beside anything: it is the one
    // call in the round a person is about to be asked about, and it should not
    // be racing something else while they read the question.
    parallelSafe: tool.parallelSafe ?? (risk === 'read' && !requiresConfirmation),
    idempotent: tool.idempotent ?? !tool.mutates,
    resource: tool.resource ?? (tool.mutates ? category : null),
    dependsOn: tool.dependsOn ?? [],
    provenance,
    timeoutMs: tool.timeoutMs ?? null,
    display: toolDisplayFor({
      name: tool.name,
      category,
      provenance,
      declared: tool.display,
    }),
  };
};

/**
 * Whether a tool that needs confirmation has been given it.
 *
 * The flag is read off the validated arguments rather than declared separately,
 * so there is one place a tool says "yes, go ahead" and the schema documents it
 * to the model like any other argument.
 */
export const isConfirmed = (args: unknown): boolean =>
  typeof args === 'object' && args !== null && (args as { confirm?: unknown }).confirm === true;

/** What the registry decided about one requested call before running it. */
export type ToolPreflight =
  | { kind: 'unknown_tool'; message: string }
  | { kind: 'invalid_arguments'; message: string }
  /** The call cannot proceed, and the message is the reason a tool would give. */
  | { kind: 'refused'; message: string }
  | { kind: 'needs_confirmation'; description: string; args: unknown; plan: ToolPlan }
  | { kind: 'ready'; args: unknown; plan: ToolPlan; tool: RegisteredTool };

/**
 * What both providers accept as a tool name.
 *
 * OpenAI and Anthropic agree on this: letters, digits, underscore, hyphen, up
 * to sixty-four characters. Nothing else, and a dot least of all.
 */
const PROVIDER_TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Pulls a number the model pushed past its own bound back onto it.
 *
 * Every limit's maximum is in the JSON Schema the model is given, so a call
 * that exceeds one is not a misunderstanding a refusal can correct — the bound
 * was already stated. Rejecting it spends the turn on a paging mistake: the
 * model asks for fifty files, is told twenty-five is the most, and reports to
 * the person that it could not read their files at all. Clamping to the stated
 * bound answers the question it was actually asking, which is "as many as you
 * will give me".
 *
 * Two restrictions keep this from becoming a licence to rewrite arguments.
 * It only ever moves a value *onto* a boundary the schema itself declared, so
 * no call reaches a tool with a number the tool would not have accepted from a
 * person. And it is applied only where nothing can be written — an inflated
 * number on a mutation is an amount, a quantity or a span of days, never a page
 * size, and rounding one of those away silently is how a model's arithmetic
 * slip becomes somebody's money.
 *
 * Returns `null` when the arguments cannot be repaired this way, which is every
 * case but the one described: a missing field, a wrong type, a nested value, an
 * exclusive bound. Those still fail, and the model still hears why.
 */
const clampToDeclaredBounds = (
  rawArguments: unknown,
  issues: readonly { code: string; path: PropertyKey[]; origin?: unknown }[],
): Record<string, unknown> | null => {
  if (typeof rawArguments !== 'object' || rawArguments === null || Array.isArray(rawArguments)) {
    return null;
  }

  const repaired: Record<string, unknown> = { ...(rawArguments as Record<string, unknown>) };

  for (const issue of issues) {
    // Only a top-level number of this call's own arguments. A nested path
    // belongs to a shape this function does not know how to reason about.
    if (issue.origin !== 'number' || issue.path.length !== 1) {
      return null;
    }

    const key = issue.path[0];

    if (typeof key !== 'string') {
      return null;
    }

    const bound =
      issue.code === 'too_big'
        ? (issue as { maximum?: unknown }).maximum
        : issue.code === 'too_small'
          ? (issue as { minimum?: unknown }).minimum
          : undefined;

    if (typeof bound !== 'number') {
      return null;
    }

    repaired[key] = bound;
  }

  return repaired;
};

/**
 * The one place a model's tool requests are turned into code.
 *
 * Nothing else dispatches on a tool name, and nothing outside a registered tool
 * runs on the model's say-so: a name that is not registered is refused, and
 * arguments are validated against the tool's own schema before it is called.
 * That is what stops a hallucinated call from reaching the database.
 *
 * The orchestrator drives it in two halves — `preflight` decides whether a call
 * may run and what it would do, `run` performs it — because a workflow has to
 * know that before it schedules anything: what is parallel-safe, what is
 * waiting on a person, what depends on what. `execute` remains the whole
 * sequence in one call, for everything that just wants the answer.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool named "${tool.name}" is already registered`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  /** The resolved metadata for one tool, or `undefined` if it is not registered. */
  plan(name: string): ToolPlan | undefined {
    const tool = this.tools.get(name);

    return tool ? resolveToolPlan(tool) : undefined;
  }

  /**
   * The tool list as the API describes it to a client: classification and
   * policy, without the argument schema, which is the model's business.
   */
  describe(): ToolDescriptor[] {
    return this.list().map((tool) => {
      const plan = resolveToolPlan(tool);

      return {
        name: tool.name,
        description: tool.description,
        category: plan.category,
        risk: plan.risk,
        mutates: plan.mutates,
        requiresConfirmation: plan.requiresConfirmation,
        parallelSafe: plan.parallelSafe,
        provenance: plan.provenance,
        display: plan.display,
      };
    });
  }

  /**
   * The tool list in the shape a provider advertises to the model.
   *
   * The classification is appended to each description rather than sent as a
   * field of its own, because no provider has a field for it and a model that
   * cannot see which of two similarly named tools writes will eventually pick
   * the wrong one. What is *not* appended is anything internal: no integration
   * ids, no resource names, no retry policy — none of that helps the model
   * choose, and all of it is surface a prompt-injected reply could aim at.
   */
  definitions(): AiToolDefinition[] {
    return this.list().flatMap((tool) => {
      // A name a provider will not accept fails the *whole* request, not the
      // one tool: the model never gets to answer, and every question in that
      // conversation comes back as "the AI service is not responding". Dropping
      // the offender costs one capability and keeps the assistant alive, which
      // is the trade worth making every time. It is logged as an error because
      // nothing here should ever be unnameable — reaching this line means a
      // tool was registered under a name that cannot be sent anywhere.
      if (!PROVIDER_TOOL_NAME.test(tool.name)) {
        log.error(
          { tool: tool.name },
          'tool name is not one a provider accepts; it is not being offered to the model',
        );

        return [];
      }

      const plan = resolveToolPlan(tool);
      const notes: string[] = [];

      if (plan.risk === 'destructive') {
        notes.push('Destructive: it removes data and cannot be undone.');
      } else if (plan.risk === 'write') {
        notes.push('This changes stored data.');
      }

      if (plan.requiresConfirmation) {
        notes.push('Ask the user first and call again with confirm: true only after they agree.');
      }

      return [
        {
          name: tool.name,
          description:
            notes.length > 0 ? `${tool.description} ${notes.join(' ')}` : tool.description,
          parameters: z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>,
        },
      ];
    });
  }

  /**
   * Decides what would happen if this call ran, without running it.
   *
   * The confirmation check lives here rather than in `run` so a workflow can
   * see a pending action coming — record it, stop scheduling, ask — instead of
   * discovering it from a result. Describing the target reads it, and that read
   * is scoped to the actor like every other, so it can fail; a failure to
   * describe becomes an ordinary refusal rather than an exception that ends the
   * turn.
   */
  async preflight(
    name: string,
    rawArguments: unknown,
    context: ToolContext,
  ): Promise<ToolPreflight> {
    const tool = this.tools.get(name);

    if (!tool) {
      return { kind: 'unknown_tool', message: `There is no tool named "${name}".` };
    }

    let parsed = tool.schema.safeParse(rawArguments ?? {});

    if (!parsed.success && !tool.mutates) {
      const repaired = clampToDeclaredBounds(rawArguments ?? {}, parsed.error.issues);
      const second = repaired === null ? null : tool.schema.safeParse(repaired);

      if (second?.success) {
        log.debug(
          { tool: name, fields: parsed.error.issues.map((issue) => issue.path.join('.')) },
          'out-of-range argument clamped to the schema bound',
        );
        parsed = second;
      }
    }

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');

      return {
        kind: 'invalid_arguments',
        message: `Invalid arguments for "${name}": ${issues}`,
      };
    }

    const plan = resolveToolPlan(tool);

    if (plan.requiresConfirmation && !isConfirmed(parsed.data)) {
      let description = `run "${name}"`;

      if (tool.describeConfirmation) {
        try {
          description = await tool.describeConfirmation(parsed.data, context);
        } catch (error) {
          // Describing the target reads it, scoped to the actor like every
          // other read, so this is where a call aimed at somebody else's record
          // ends: as an ordinary refusal carrying the tool's own "not found".
          // Proposing a generic action instead would confirm the record exists.
          log.warn({ tool: name, err: error }, 'confirmation target could not be described');

          return {
            kind: 'refused',
            message: error instanceof Error ? error.message : `The tool "${name}" failed.`,
          };
        }
      }

      return { kind: 'needs_confirmation', description, args: parsed.data, plan };
    }

    return { kind: 'ready', args: parsed.data, plan, tool };
  }

  /**
   * Runs a call that has already passed preflight.
   *
   * Throws rather than returning a failure: the orchestrator needs the original
   * error to decide whether it looks transient enough to retry, and flattening
   * it into a string here would throw that decision away.
   */
  static async run(tool: RegisteredTool, args: unknown, context: ToolContext): Promise<ToolResult> {
    return tool.execute(args, context);
  }

  /**
   * Runs one requested call. Failures are returned, not thrown: a tool that
   * cannot answer should let the model try something else, and the transcript
   * should record what went wrong.
   */
  async execute(
    name: string,
    rawArguments: unknown,
    context: ToolContext,
  ): Promise<{ result: ToolResult; status: ToolCallStatus; durationMs: number }> {
    const startedAt = Date.now();
    const preflight = await this.preflight(name, rawArguments, context);

    if (
      preflight.kind === 'unknown_tool' ||
      preflight.kind === 'invalid_arguments' ||
      preflight.kind === 'refused'
    ) {
      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        result: { summary: preflight.message },
      };
    }

    if (preflight.kind === 'needs_confirmation') {
      return {
        status: 'needs_confirmation',
        durationMs: Date.now() - startedAt,
        result: {
          summary: `Confirmation needed: ${preflight.description}. Ask the user to confirm, then call "${name}" again with confirm: true. Do not assume they agreed.`,
          data: { needsConfirmation: true, tool: name },
        },
      };
    }

    try {
      const result = await ToolRegistry.run(preflight.tool, preflight.args, context);

      return { status: 'succeeded', durationMs: Date.now() - startedAt, result };
    } catch (error) {
      log.warn({ tool: name, err: error }, 'tool execution failed');

      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        result: {
          summary: error instanceof Error ? error.message : `The tool "${name}" failed.`,
        },
      };
    }
  }
}
