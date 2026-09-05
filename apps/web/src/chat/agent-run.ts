import { toStreamEvent, type AgentEvent, type ToolCategory, type ToolRisk } from '@hadiya/shared';

/**
 * What the browser knows about the turn it is watching.
 *
 * The server is the authority on all of it — every field here is derived from
 * an event the server emitted, and nothing is guessed, predicted or filled in
 * while waiting. That is the rule the whole feature stands on: a timeline that
 * invented one step would make every other step unbelievable, and a person
 * reading "saved to Notion" needs that to mean Notion said so.
 *
 * The reducer mutates rather than rebuilding. A streamed answer arrives a few
 * characters at a time, and replacing the state object on every delta would
 * hand Vue a new identity for the step list dozens of times a second, redrawing
 * a timeline that has not changed. Mutating lets the reactivity system update
 * only the text that actually moved.
 */

/** Where the run is, as the interface needs to think about it. */
export type AgentRunState =
  'idle' | 'running' | 'waiting_confirmation' | 'completed' | 'failed' | 'cancelled';

/** How one step of the timeline is drawn. */
export type ActivityStatus = 'running' | 'completed' | 'failed' | 'skipped';

export interface ActivityStep {
  /** The server's id for the call. Two events with this id are one step. */
  callId: string;
  toolName: string;
  displayName: string;
  runningLabel: string;
  doneLabel: string;
  category: ToolCategory;
  risk: ToolRisk;
  /** The connected service it came from, when there is one. */
  integration: string | null;
  status: ActivityStatus;
  /**
   * Steps that were in flight together share a number.
   *
   * Derived from the events themselves rather than declared: a step that starts
   * while another is still running genuinely ran beside it, and that is exactly
   * what the server's own waves look like from here. It is what lets the
   * timeline show three reads happening at once instead of implying an order
   * the backend never had.
   */
  wave: number;
  /** Above one means it was retried, which is worth showing. */
  attempts: number;
  durationMs: number | null;
  /** Why it did not work, in the server's words. Null when it did. */
  message: string | null;
}

/** An action waiting on the person, as the card needs it. */
export interface PendingConfirmation {
  pendingActionId: string;
  toolCallId: string;
  title: string;
  description: string;
  integration: string | null;
  expiresAt: string;
}

export interface AgentRun {
  runId: string | null;
  state: AgentRunState;
  steps: ActivityStep[];
  confirmation: PendingConfirmation | null;
  /** The answer as it is being written. Empty when the provider cannot stream. */
  streamingText: string;
  streamingMessageId: string | null;
  /** A failure that ended the run, written for a person. */
  error: string | null;
  /** True while a dropped connection is being rejoined. */
  reconnecting: boolean;
  /** The highest event id applied. Both the resume point and the dedup key. */
  lastSequence: number;
  startedAt: string | null;
}

export const emptyRun = (): AgentRun => ({
  runId: null,
  state: 'idle',
  steps: [],
  confirmation: null,
  streamingText: '',
  streamingMessageId: null,
  error: null,
  reconnecting: false,
  lastSequence: 0,
  startedAt: null,
});

const stepFor = (run: AgentRun, callId: string): ActivityStep | undefined =>
  run.steps.find((step) => step.callId === callId);

/** The wave a step starting now belongs to. */
const waveForNewStep = (run: AgentRun): number => {
  const inFlight = run.steps.find((step) => step.status === 'running');

  if (inFlight) {
    return inFlight.wave;
  }

  return run.steps.reduce((highest, step) => Math.max(highest, step.wave), 0) + 1;
};

/**
 * Applies one event.
 *
 * De-duplication is by sequence and is the reason a reconnection is safe: the
 * server replays from the last id the client saw, and anything at or below the
 * highest already applied is dropped rather than drawn a second time. It is
 * also what makes two tabs watching one run agree — both are folding the same
 * numbered stream.
 *
 * An event this build does not understand is ignored. A browser holding
 * yesterday's bundle should render the steps it knows and skip the rest, not
 * throw in the middle of somebody's answer.
 */
export const applyAgentEvent = (run: AgentRun, event: AgentEvent): boolean => {
  if (event.sequence <= run.lastSequence) {
    return false;
  }

  const typed = toStreamEvent(event);

  if (!typed) {
    // Still counted: an unknown event has been seen, and a resume should not
    // ask for it again.
    run.lastSequence = event.sequence;

    return false;
  }

  run.lastSequence = event.sequence;
  run.runId ??= typed.runId;

  switch (typed.type) {
    case 'agent.started':
      run.state = 'running';
      run.startedAt = typed.timestamp;

      return true;

    case 'tool.started': {
      const existing = stepFor(run, typed.toolCallId);

      if (existing) {
        // A retry of a step already on screen: the same row goes back to
        // running rather than a second row appearing beside it.
        existing.status = 'running';
        existing.attempts = typed.attempt;
        existing.message = null;

        return true;
      }

      run.steps.push({
        callId: typed.toolCallId,
        toolName: typed.toolName,
        displayName: typed.displayName,
        runningLabel: typed.runningLabel,
        doneLabel: typed.doneLabel,
        category: typed.category,
        risk: typed.risk,
        integration: typed.integration,
        status: 'running',
        wave: waveForNewStep(run),
        attempts: typed.attempt,
        durationMs: null,
        message: null,
      });

      return true;
    }

    case 'tool.retrying': {
      const step = stepFor(run, typed.toolCallId);

      if (step) {
        step.status = 'running';
        step.attempts = typed.attempt + 1;
      }

      return true;
    }

    case 'tool.completed': {
      const step = stepFor(run, typed.toolCallId);

      if (step) {
        step.status = 'completed';
        step.durationMs = typed.durationMs;
        step.attempts = typed.attempts;
      }

      return true;
    }

    case 'tool.failed': {
      const step = stepFor(run, typed.toolCallId);

      if (step) {
        step.status = 'failed';
        step.attempts = typed.attempts;
        step.message = typed.message;

        return true;
      }

      // A step that failed before it ever started — an unknown tool, arguments
      // that did not validate. It is still a step that happened.
      run.steps.push({
        callId: typed.toolCallId || `failed-${String(typed.sequence)}`,
        toolName: typed.toolName,
        displayName: typed.displayName,
        runningLabel: typed.runningLabel,
        doneLabel: typed.doneLabel,
        category: typed.category,
        risk: typed.risk,
        integration: typed.integration,
        status: 'failed',
        wave: waveForNewStep(run),
        attempts: typed.attempts,
        durationMs: null,
        message: typed.message,
      });

      return true;
    }

    case 'tool.skipped': {
      const step = stepFor(run, typed.toolCallId);

      if (step) {
        step.status = 'skipped';
        step.message = typed.reason;
      }

      return true;
    }

    case 'confirmation.required':
      run.state = 'waiting_confirmation';
      run.confirmation = {
        pendingActionId: typed.pendingActionId,
        toolCallId: typed.toolCallId,
        title: typed.title,
        description: typed.description,
        integration: typed.integration,
        expiresAt: typed.expiresAt,
      };

      return true;

    case 'assistant.delta':
      // A new message id supersedes the last: an earlier round's text was the
      // model thinking aloud before it called a tool, and the answer being
      // written now replaces it rather than continuing it.
      if (run.streamingMessageId !== typed.messageId) {
        run.streamingMessageId = typed.messageId;
        run.streamingText = '';
      }

      run.streamingText += typed.delta;

      return true;

    case 'assistant.completed':
      return true;

    case 'agent.completed':
      run.state = run.confirmation ? 'waiting_confirmation' : 'completed';

      return true;

    case 'agent.failed':
      run.state = 'failed';
      run.error = typed.message;

      return true;

    case 'agent.cancelled':
      run.state = 'cancelled';
      run.confirmation = null;

      return true;

    default:
      return false;
  }
};

/** Whether the run is still going, and so whether Stop should be offered. */
export const isRunActive = (run: AgentRun): boolean =>
  run.state === 'running' || run.state === 'waiting_confirmation';

/** Whether a proposal can still be acted on. */
export const isConfirmationLive = (
  confirmation: PendingConfirmation | null,
  now: number = Date.now(),
): boolean => confirmation !== null && Date.parse(confirmation.expiresAt) > now;

/**
 * One honest sentence about how the run ended.
 *
 * Generated from the steps rather than from the model's prose, and only when
 * something actually failed: a run where everything worked needs no summary
 * beyond the answer itself, and adding one would be noise.
 */
export const failureSummary = (run: AgentRun): string | null => {
  const failed = run.steps.filter((step) => step.status === 'failed' || step.status === 'skipped');

  if (failed.length === 0) {
    return null;
  }

  const done = run.steps.filter((step) => step.status === 'completed').length;
  const names = failed.map((step) => step.displayName).join(', ');

  return done > 0
    ? `${String(done)} of ${String(run.steps.length)} steps finished. ${names} did not.`
    : `${names} did not work.`;
};
