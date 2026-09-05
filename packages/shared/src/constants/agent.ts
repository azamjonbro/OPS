/**
 * The vocabulary of one agent run.
 *
 * Phase 11 turns a single ask-the-model-run-a-tool exchange into a workflow
 * that can span several rounds, several tools and — when something needs
 * agreeing to — several messages. That workflow has a state, it emits events,
 * and the tools it runs carry more metadata than "does this write". All three
 * live here rather than in the API, because the frontend renders them and a
 * second copy of an enum is a second thing to get wrong.
 */

/**
 * Where a run is.
 *
 * `waiting_for_confirmation` is the one that is not a step on the way to
 * `completed`: the run stopped on purpose and is waiting for a person, and the
 * next message in the conversation is what resumes it. `recovering` means a
 * tool failed and the agent is deciding whether it can carry on — retrying, or
 * continuing with what did work.
 */
export const AGENT_STATES = [
  'idle',
  'planning',
  'executing',
  'waiting_for_confirmation',
  'recovering',
  'completed',
  'failed',
  'cancelled',
] as const;

export type AgentState = (typeof AGENT_STATES)[number];

/** States a run cannot leave. */
export const TERMINAL_AGENT_STATES = ['completed', 'failed', 'cancelled'] as const;

export const isTerminalAgentState = (state: AgentState): boolean =>
  (TERMINAL_AGENT_STATES as readonly string[]).includes(state);

/**
 * What a run reports as it goes.
 *
 * Written as a fixed list because these are a contract with whatever renders
 * them — a streaming UI later, the transcript today — and because an event type
 * invented at a call site is an event type nobody handles. Payloads are
 * deliberately small: a name, a status, a duration. Never arguments, never
 * results, never anything that came back from an external service.
 */
export const AGENT_EVENT_TYPES = [
  'agent.started',
  'agent.thinking',
  'tool.started',
  'tool.completed',
  'tool.failed',
  'tool.retrying',
  'tool.skipped',
  'confirmation.required',
  // The assistant's own words as they arrive, when the provider can send them
  // that way. `assistant.completed` closes the message whether or not any delta
  // preceded it, so a client has one place to stop showing a partial answer.
  'assistant.delta',
  'assistant.completed',
  'agent.completed',
  'agent.failed',
  'agent.cancelled',
] as const;

export type AgentEventType = (typeof AGENT_EVENT_TYPES)[number];

/**
 * How much damage a tool could do.
 *
 * The same three words the MCP hub already uses, so a native tool and a
 * discovered one are classified on one scale. `unknown` is deliberately absent:
 * a tool written in this repository is one whose author knows what it does, and
 * an MCP tool that could not be classified is mapped to `write` — the
 * conservative reading — when it enters the registry.
 */
export const TOOL_RISKS = ['read', 'write', 'destructive'] as const;

export type ToolRisk = (typeof TOOL_RISKS)[number];

/**
 * Roughly what a tool is for, so the model can narrow a long list before it
 * reads descriptions, and so a UI can group what ran.
 */
export const TOOL_CATEGORIES = [
  'memory',
  'business',
  'content',
  'image',
  'reminder',
  'integration',
  'other',
] as const;

export type ToolCategory = (typeof TOOL_CATEGORIES)[number];

/** Where a tool came from, kept on every call so provenance survives the turn. */
export const TOOL_SOURCES = ['native', 'billz', 'notion', 'mcp'] as const;

export type ToolSource = (typeof TOOL_SOURCES)[number];

/**
 * How a single tool call ended, one level finer than the transcript's own
 * `ToolCallStatus`.
 *
 * `skipped` is the one worth naming: a call that never ran because something it
 * depended on failed, or because the run was cancelled before its turn. It is
 * not a failure of that tool and must not be reported as one — and it is
 * certainly not a success.
 */
export const AGENT_STEP_OUTCOMES = [
  'succeeded',
  'failed',
  'timed_out',
  'needs_confirmation',
  'skipped',
  'cancelled',
] as const;

export type AgentStepOutcome = (typeof AGENT_STEP_OUTCOMES)[number];

/**
 * The default budget for one run.
 *
 * Every number here is a ceiling on somebody's money or patience, so each is
 * overridable per deployment (`AGENT_*` environment variables) and per call
 * (the agent's own options, which is how tests pin them). The defaults are
 * chosen for a shopkeeper's question rather than for a research task: a handful
 * of rounds is enough for "read the sales, write three posts, save them", and
 * anything past that is usually a model going in circles.
 */
export const AGENT_LIMITS = {
  /** Rounds in which the model may ask for tools before it must answer. */
  maxToolRounds: 6,
  /** Completions per run, including the closing one. The hard cost ceiling. */
  maxModelCalls: 8,
  /** Tool calls run at once. Beyond this they queue. */
  maxParallelTools: 4,
  /** One tool call, including its retries' waiting. */
  toolTimeoutMs: 45_000,
  /** Extra attempts after the first, for failures that look transient. */
  maxToolRetries: 2,
  /** First backoff pause; doubles per attempt. */
  retryBackoffMs: 250,
  /** Prompt + completion tokens a run may spend before tools are withheld. */
  tokenBudget: 120_000,
} as const;

export type AgentLimits = { -readonly [K in keyof typeof AGENT_LIMITS]: number };

/** How long an agreement request stands before it has to be asked again. */
export const PENDING_ACTION_TTL_MS = 10 * 60 * 1_000;

/** How a pending action ended, or that it has not. */
export const PENDING_ACTION_STATUSES = ['pending', 'confirmed', 'cancelled', 'expired'] as const;

export type PendingActionStatus = (typeof PENDING_ACTION_STATUSES)[number];
