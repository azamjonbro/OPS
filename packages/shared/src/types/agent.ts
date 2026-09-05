import type {
  AgentEventType,
  AgentState,
  AgentStepOutcome,
  PendingActionStatus,
  ToolCategory,
  ToolRisk,
  ToolSource,
} from '../constants/agent.js';

/**
 * Where a tool came from, carried on every call and every event.
 *
 * The agent treats a Billz capability, a Notion reader and somebody's own MCP
 * tool identically — that is the point of the registry — but the *answer* must
 * still be able to say which server produced a figure. Provenance is how a
 * result stays attributable after it has been flattened into a tool message.
 */
export interface ToolProvenance {
  source: ToolSource;
  /** The connected integration this came from, when there is one. */
  integrationId: string | null;
  /** Its display name, safe to show. Never a URL and never a credential. */
  integrationName: string | null;
  /** The tool's name on the far side, before Hadiya namespaced it. */
  externalName: string | null;
}

/**
 * A tool as the API describes it to a client.
 *
 * Deliberately not what the model is shown: this carries the classification and
 * the confirmation policy so a UI can warn before a write is proposed, and it
 * omits the JSON Schema, which is the model's business rather than a person's.
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  category: ToolCategory;
  risk: ToolRisk;
  mutates: boolean;
  requiresConfirmation: boolean;
  /** Whether this tool may run beside another in the same round. */
  parallelSafe: boolean;
  provenance: ToolProvenance;
  /**
   * What to call it on a screen. Decided server-side so a client does not need
   * a phrase of its own for every tool — including the ones on somebody's own
   * MCP server, which it has never heard of.
   */
  display: { displayName: string; runningLabel: string; doneLabel: string };
}

/** One tool call inside a run, as it actually went. */
export interface AgentStep {
  callId: string;
  tool: string;
  round: number;
  outcome: AgentStepOutcome;
  risk: ToolRisk;
  category: ToolCategory;
  provenance: ToolProvenance;
  durationMs: number;
  /** Attempts made, including the first. Above one means a retry happened. */
  attempts: number;
  /** Why it did not succeed, written for a person. Null when it did. */
  error: string | null;
}

/**
 * One thing that happened during a run.
 *
 * `data` is a small, flat, already-safe record. Nothing that came back from a
 * model or an external service is ever put in it — no arguments, no results, no
 * credentials — because these are designed to be streamed straight to a browser
 * and anything in them is effectively public to whoever is watching.
 */
export interface AgentEvent {
  type: AgentEventType;
  /** Monotonic within a run, so a client can order what it received. */
  sequence: number;
  at: string;
  workflowId: string;
  conversationId: string;
  data: Record<string, string | number | boolean | null>;
}

/** An action the agent has prepared and is waiting to be told to take. */
export interface PendingActionSummary {
  id: string;
  conversationId: string;
  workflowId: string;
  tool: string;
  /** What the person is being asked to agree to, in their own terms. */
  description: string;
  status: PendingActionStatus;
  integrationId: string | null;
  integrationName: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * What one run did, attached to the reply.
 *
 * Additive: every existing field of `ChatResponse` still means what it did, and
 * a client that ignores this block behaves exactly as it did before. It exists
 * so a UI can show progress honestly — which step failed, what is still waiting
 * on the person — without having to infer any of it from prose the model wrote.
 */
export interface AgentRunSummary {
  workflowId: string;
  state: AgentState;
  /** Rounds in which the model asked for tools. */
  rounds: number;
  modelCalls: number;
  steps: AgentStep[];
  events: AgentEvent[];
  /** Actions waiting on the person. Empty unless the state says otherwise. */
  pendingActions: PendingActionSummary[];
  /** True when the run stopped because a budget ran out rather than because it finished. */
  limitReached: boolean;
  tokensSpent: number;
}
