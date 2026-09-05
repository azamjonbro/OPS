import type {
  AgentEvent,
  AgentRunSnapshot,
  AgentRunSummary,
  AgentState,
  AgentStreamFrame,
  ChatResponse,
} from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { createLogger } from '../../../core/logger/logger.js';
import { onAgentEvent } from './agent-events.js';

const log = createLogger('agent-runs');

/**
 * The runs this process is currently able to talk about.
 *
 * Phase 11's agent emits events as it goes and, until now, nobody was listening
 * except the log and the reply. Streaming needs two more things from those same
 * events, and both are about *time*:
 *
 *  - **A buffer.** A browser cannot subscribe before the run exists, and a
 *    reconnecting one has missed whatever happened while it was away. Without a
 *    replay buffer the first events of every run are lost to a race, which is
 *    exactly the half that says what the assistant started doing.
 *  - **An owner.** A run id is a string in a URL. Streaming one to whoever asks
 *    would be a cross-account leak with extra steps, so the account that
 *    started a run is recorded when it opens and checked on every subscription.
 *
 * State is per process and in memory, which is the honest scope: these are this
 * process's in-flight runs, and the events are already persisted where they
 * matter — the transcript holds every tool call and its result, and the reply
 * carries the run summary. Losing this on a restart costs a live view, never a
 * record. Behind several instances a stream must reach the instance running the
 * turn; the streaming `POST` does that by construction, and a reconnection that
 * lands elsewhere is answered as a finished run rather than a wrong one.
 */

type Subscriber = (frame: AgentStreamFrame) => void;

interface RunRecord {
  runId: string;
  conversationId: string;
  userId: string;
  state: AgentState;
  startedAt: string;
  finishedAt: string | null;
  events: AgentEvent[];
  summary: AgentRunSummary | null;
  response: ChatResponse | null;
  error: { code: string; message: string } | null;
  subscribers: Set<Subscriber>;
}

/** Events kept per run for replay. Beyond this the oldest are forgotten. */
const MAX_BUFFERED_EVENTS = 500;
/** How long a finished run can still be read back, for a late reconnection. */
const FINISHED_RUN_TTL_MS = 5 * 60 * 1_000;
/** Runs held at once, newest kept. A ceiling on what a busy process retains. */
const MAX_RUNS = 200;

const runs = new Map<string, RunRecord>();

const sweep = (): void => {
  const now = Date.now();

  for (const [runId, run] of runs) {
    if (run.finishedAt && now - Date.parse(run.finishedAt) > FINISHED_RUN_TTL_MS) {
      runs.delete(runId);
    }
  }

  // Insertion order is start order, so the oldest go first when the map is
  // over its ceiling. A live run is never evicted this way unless the process
  // is running more concurrent turns than the ceiling allows, which would be a
  // capacity problem rather than a bookkeeping one.
  while (runs.size > MAX_RUNS) {
    const oldest = [...runs.entries()].find(([, run]) => run.finishedAt !== null) ?? null;

    if (!oldest) {
      break;
    }

    runs.delete(oldest[0]);
  }
};

/** Registers a run so its events can be buffered and watched. */
export const openRun = (options: {
  runId: string;
  conversationId: string;
  userId: string;
}): void => {
  sweep();

  runs.set(options.runId, {
    runId: options.runId,
    conversationId: options.conversationId,
    userId: options.userId,
    state: 'planning',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    events: [],
    summary: null,
    response: null,
    error: null,
    subscribers: new Set(),
  });
};

const fanOut = (run: RunRecord, frame: AgentStreamFrame): void => {
  for (const subscriber of run.subscribers) {
    try {
      subscriber(frame);
    } catch (error) {
      // A dead socket must not take the run down with it.
      log.warn({ run: run.runId, err: error }, 'stream subscriber failed');
    }
  }
};

/**
 * Records the finished turn and tells every watcher.
 *
 * The `ChatResponse` is the same object a non-streaming caller receives, so a
 * client that watched the run and one that waited for the POST end up holding
 * exactly the same thing — there is no second, thinner truth for streaming
 * clients to reconcile.
 */
export const closeRun = (
  runId: string,
  outcome: { response: ChatResponse; summary?: AgentRunSummary | null },
): void => {
  const run = runs.get(runId);

  if (!run) {
    return;
  }

  run.finishedAt = new Date().toISOString();
  run.response = outcome.response;
  run.summary = outcome.summary ?? outcome.response.agent ?? null;
  run.state = run.summary?.state ?? 'completed';

  fanOut(run, { frame: 'result', response: outcome.response });
  run.subscribers.clear();
};

/** Records a run that could not finish, in words that are safe to show. */
export const failRun = (runId: string, error: { code: string; message: string }): void => {
  const run = runs.get(runId);

  if (!run) {
    return;
  }

  run.finishedAt = new Date().toISOString();
  run.state = 'failed';
  run.error = error;

  fanOut(run, { frame: 'error', ...error });
  run.subscribers.clear();
};

/**
 * The one listener that feeds every open run.
 *
 * Installed at module load rather than per run, so the agent does not have to
 * know a registry exists: it emits, as it always did, and what is watching is
 * somebody else's problem. Events for a run nobody opened are ignored, which is
 * what happens in a test that drives the agent directly.
 */
onAgentEvent((event) => {
  const run = runs.get(event.workflowId);

  if (!run) {
    return;
  }

  run.events.push(event);

  if (run.events.length > MAX_BUFFERED_EVENTS) {
    run.events.shift();
  }

  fanOut(run, { frame: 'event', event });
});

export interface SubscribeOptions {
  runId: string;
  userId: string;
  /** Everything after this sequence is replayed. From `Last-Event-ID`. */
  afterSequence?: number;
  onFrame: Subscriber;
}

export interface Subscription {
  /** Delivered synchronously before any live frame, so nothing interleaves. */
  replay: AgentStreamFrame[];
  finished: boolean;
  unsubscribe: () => void;
}

/**
 * Reads a run this account owns.
 *
 * `notFound` rather than `forbidden` for somebody else's run: telling a
 * stranger that a run id exists but is not theirs is a fact they had no way to
 * learn and no business knowing.
 */
const ownedRun = (runId: string, userId: string): RunRecord => {
  const run = runs.get(runId);

  if (!run || run.userId !== userId) {
    throw ApiError.notFound('That run is not available.');
  }

  return run;
};

/**
 * Attaches a watcher, catching it up first.
 *
 * The catch-up and the attachment happen in one synchronous step. That is the
 * whole point: anything else leaves a window in which an event is emitted after
 * the buffer was read and before the subscriber was registered, and that event
 * is then lost — silently, and exactly when the run is busiest.
 */
export const subscribeToRun = (options: SubscribeOptions): Subscription => {
  const run = ownedRun(options.runId, options.userId);
  const after = options.afterSequence ?? 0;
  const replay: AgentStreamFrame[] = run.events
    .filter((event) => event.sequence > after)
    .map((event) => ({ frame: 'event', event }) as const);

  if (run.finishedAt) {
    if (run.response) {
      replay.push({ frame: 'result', response: run.response });
    } else if (run.error) {
      replay.push({ frame: 'error', ...run.error });
    }

    return { replay, finished: true, unsubscribe: () => undefined };
  }

  run.subscribers.add(options.onFrame);

  return {
    replay,
    finished: false,
    unsubscribe: () => {
      run.subscribers.delete(options.onFrame);
    },
  };
};

/** Everything known about a run, for a browser that has just reloaded. */
export const runSnapshot = (runId: string, userId: string): AgentRunSnapshot => {
  const run = ownedRun(runId, userId);

  return {
    runId: run.runId,
    conversationId: run.conversationId,
    state: run.state,
    active: run.finishedAt === null,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    events: [...run.events],
    summary: run.summary,
  };
};

/**
 * The newest run this account has in a conversation, if this process has one.
 *
 * How a reloaded browser finds its way back: it knows the conversation from the
 * URL and nothing else, and this turns that into a run it may watch. `null` is
 * an ordinary answer — the run may have finished and been swept, or be on
 * another instance — and means "nothing live to show", not an error.
 */
export const latestRunForConversation = (
  userId: string,
  conversationId: string,
): AgentRunSnapshot | null => {
  let newest: RunRecord | null = null;

  for (const run of runs.values()) {
    if (run.userId !== userId || run.conversationId !== conversationId) {
      continue;
    }

    if (!newest || run.startedAt >= newest.startedAt) {
      newest = run;
    }
  }

  return newest ? runSnapshot(newest.runId, userId) : null;
};

/** How many sockets are watching a run. For tests and for a health line. */
export const subscriberCount = (runId: string): number => runs.get(runId)?.subscribers.size ?? 0;

/** Testing seam: forgets every run and drops every watcher. */
export const resetRunRegistry = (): void => {
  for (const run of runs.values()) {
    run.subscribers.clear();
  }

  runs.clear();
};
