import type { AgentEventType, AgentState, ToolCategory, ToolRisk } from '../constants/agent.js';
import type { AgentEvent, AgentRunSummary } from './agent.js';
import type { ChatResponse } from './ai.js';

/**
 * What a browser watching a run receives, and how to read it.
 *
 * There is one event type on the wire and it is Phase 11's `AgentEvent`: a
 * type, a sequence, a timestamp, the run and conversation it belongs to, and a
 * flat `data` record that has already been through the sanitiser. Nothing here
 * replaces that. What this file adds is the *reading* of `data` — a typed view
 * with named fields, and the single function that produces it.
 *
 * That split is deliberate. `data` is flat and permissive because the sanitiser
 * has to be able to drop anything it does not recognise, which is what keeps a
 * credential out of a stream aimed at a browser. But a component should not be
 * indexing a loose record and hoping a key is there. So the loose record stays
 * the wire format, and `toStreamEvent` is the one place it is interpreted —
 * shared, so the server and the client cannot disagree about what a field
 * means.
 *
 * Everything here is safe to render. There is no prompt in it, no model
 * message, no tool argument, no raw upstream response, and no reasoning: an
 * event says *what step is happening*, never *why the model chose it*.
 */

/** Fields every event carries, whatever kind it is. */
export interface AgentStreamBase {
  runId: string;
  conversationId: string;
  /** Monotonic within a run. Also the SSE event id, so it drives resumption. */
  sequence: number;
  timestamp: string;
}

/** What a tool is called and what to say about it, decided server-side. */
export interface ToolDisplay {
  /** The registered name. Only ever a fallback for display. */
  toolName: string;
  /** A short noun phrase for a person: "Sales figures". */
  displayName: string;
  /** Present tense, while it runs: "Reading the sales figures". */
  runningLabel: string;
  /** Past tense, once it is done: "Read the sales figures". */
  doneLabel: string;
  category: ToolCategory;
  risk: ToolRisk;
  /** The connected service it came from, when there is one. Safe to show. */
  integration: string | null;
}

export type AgentStreamEvent =
  | ({ type: 'agent.started'; toolsAvailable: number } & AgentStreamBase)
  | ({ type: 'agent.thinking'; round: number } & AgentStreamBase)
  | ({ type: 'tool.started'; toolCallId: string; attempt: number } & ToolDisplay & AgentStreamBase)
  | ({
      type: 'tool.completed';
      toolCallId: string;
      durationMs: number;
      attempts: number;
    } & ToolDisplay &
      AgentStreamBase)
  | ({
      type: 'tool.failed';
      toolCallId: string;
      attempts: number;
      /** Written for a person. Never an upstream body and never a stack. */
      message: string;
    } & ToolDisplay &
      AgentStreamBase)
  | ({ type: 'tool.retrying'; toolCallId: string; attempt: number } & ToolDisplay & AgentStreamBase)
  | ({
      type: 'tool.skipped';
      toolCallId: string;
      /** Why it never ran, in one safe phrase. */
      reason: string;
    } & ToolDisplay &
      AgentStreamBase)
  | ({
      type: 'confirmation.required';
      pendingActionId: string;
      toolCallId: string;
      title: string;
      /** What the person is being asked to agree to, in their terms. */
      description: string;
      expiresAt: string;
    } & ToolDisplay &
      AgentStreamBase)
  | ({ type: 'assistant.delta'; messageId: string; delta: string } & AgentStreamBase)
  | ({ type: 'assistant.completed'; messageId: string } & AgentStreamBase)
  | ({ type: 'agent.completed'; state: AgentState; limitReached: boolean } & AgentStreamBase)
  | ({ type: 'agent.failed'; message: string } & AgentStreamBase)
  | ({ type: 'agent.cancelled' } & AgentStreamBase);

/**
 * The frames an SSE connection carries.
 *
 * Events are the bulk of it. `result` arrives once, at the end of a streaming
 * `POST /ai/chat`, and is the same `ChatResponse` a non-streaming caller would
 * have received — so a client that streams and a client that does not end up
 * holding exactly the same thing. `error` is a run that could not finish.
 */
export type AgentStreamFrame =
  | { frame: 'ready'; runId: string; conversationId: string }
  | { frame: 'event'; event: AgentEvent }
  | { frame: 'result'; response: ChatResponse }
  | { frame: 'error'; code: string; message: string };

/** A finished or in-flight run, for a client that has just reloaded. */
export interface AgentRunSnapshot {
  runId: string;
  conversationId: string;
  state: AgentState;
  /** True while the run is still going and can still be watched. */
  active: boolean;
  startedAt: string;
  finishedAt: string | null;
  events: AgentEvent[];
  /** The finished turn, once there is one. */
  summary: AgentRunSummary | null;
}

/* -------------------------------------------------------------------------- */

const str = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;

const num = (value: unknown, fallback = 0): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const bool = (value: unknown, fallback = false): boolean =>
  typeof value === 'boolean' ? value : fallback;

const nullableStr = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** The display half of a tool event, with a readable fallback for every field. */
const readDisplay = (data: Record<string, unknown>): ToolDisplay => {
  const toolName = str(data.tool, 'tool');
  const displayName = str(data.displayName) || toolName;

  return {
    toolName,
    displayName,
    runningLabel: str(data.runningLabel) || displayName,
    doneLabel: str(data.doneLabel) || displayName,
    category: (str(data.category, 'other') as ToolCategory) ?? 'other',
    risk: (str(data.risk, 'read') as ToolRisk) ?? 'read',
    integration: nullableStr(data.integration),
  };
};

/**
 * Reads one wire event into its typed form.
 *
 * Returns `null` for a type this build does not know, which is the behaviour a
 * rolling deploy needs: a browser holding yesterday's bundle meets tomorrow's
 * event, ignores it, and goes on rendering the ones it understands rather than
 * throwing in the middle of a run.
 */
export const toStreamEvent = (event: AgentEvent): AgentStreamEvent | null => {
  const base: AgentStreamBase = {
    runId: event.workflowId,
    conversationId: event.conversationId,
    sequence: event.sequence,
    timestamp: event.at,
  };
  const data = event.data as Record<string, unknown>;
  const type: AgentEventType = event.type;

  switch (type) {
    case 'agent.started':
      return { ...base, type, toolsAvailable: num(data.tools) };

    case 'agent.thinking':
      return { ...base, type, round: num(data.round) };

    case 'tool.started':
      return {
        ...base,
        type,
        ...readDisplay(data),
        toolCallId: str(data.callId),
        attempt: num(data.attempt, 1),
      };

    case 'tool.completed':
      return {
        ...base,
        type,
        ...readDisplay(data),
        toolCallId: str(data.callId),
        durationMs: num(data.durationMs),
        attempts: num(data.attempts, 1),
      };

    case 'tool.failed':
      return {
        ...base,
        type,
        ...readDisplay(data),
        toolCallId: str(data.callId),
        attempts: num(data.attempts, 1),
        message: str(data.message, 'That step did not work.'),
      };

    case 'tool.retrying':
      return {
        ...base,
        type,
        ...readDisplay(data),
        toolCallId: str(data.callId),
        attempt: num(data.attempt, 1),
      };

    case 'tool.skipped':
      return {
        ...base,
        type,
        ...readDisplay(data),
        toolCallId: str(data.callId),
        reason: str(data.reason, 'skipped'),
      };

    case 'confirmation.required':
      return {
        ...base,
        type,
        ...readDisplay(data),
        pendingActionId: str(data.pendingActionId),
        toolCallId: str(data.callId),
        title: str(data.title) || readDisplay(data).displayName,
        description: str(data.description),
        expiresAt: str(data.expiresAt),
      };

    case 'assistant.delta':
      return { ...base, type, messageId: str(data.messageId), delta: str(data.delta) };

    case 'assistant.completed':
      return { ...base, type, messageId: str(data.messageId) };

    case 'agent.completed':
      return {
        ...base,
        type,
        state: str(data.state, 'completed') as AgentState,
        limitReached: bool(data.limitReached),
      };

    case 'agent.failed':
      return { ...base, type, message: str(data.message, 'The assistant could not finish.') };

    case 'agent.cancelled':
      return { ...base, type };

    default:
      return null;
  }
};

/** Whether an event ends the run, so a client knows when to stop watching. */
export const isTerminalStreamEvent = (type: AgentEventType): boolean =>
  type === 'agent.completed' || type === 'agent.failed' || type === 'agent.cancelled';
