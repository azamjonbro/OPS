import { createLogger } from '../../../core/logger/logger.js';

const log = createLogger('agent-cancellation');

/**
 * Stopping a run that is already going.
 *
 * A workflow can be several tool calls deep when a person changes their mind,
 * and "cancel" has to mean something more useful than closing the browser tab:
 * no further tool may start, anything waiting on agreement must not later be
 * taken as agreed, and the conversation must still read as an honest record of
 * what happened.
 *
 * The mechanism is an `AbortController` per run. It is what tools already
 * understand — every HTTP client in this codebase takes a signal — so
 * cancellation reaches an in-flight request rather than only the gap between
 * two of them. What it cannot do is un-send a request that has already left, so
 * a write that was in the air when cancel arrived may still land; the run
 * records that honestly rather than claiming it stopped in time.
 *
 * State is per process and in memory, which is the right scope: these are this
 * process's in-flight requests, and a run on another instance is not something
 * this one could abort anyway. A cancel that arrives at the wrong instance
 * finds nothing to abort and still cancels the pending actions, which is the
 * half that is stored.
 */

interface RunHandle {
  controller: AbortController;
  conversationId: string;
  userId: string;
  startedAt: number;
}

const runs = new Map<string, RunHandle>();

/** Registers a run so it can be cancelled, and returns its signal. */
export const registerRun = (options: {
  workflowId: string;
  conversationId: string;
  userId: string;
}): AbortSignal => {
  const controller = new AbortController();

  runs.set(options.workflowId, {
    controller,
    conversationId: options.conversationId,
    userId: options.userId,
    startedAt: Date.now(),
  });

  return controller.signal;
};

/** Forgets a finished run. Safe to call twice. */
export const releaseRun = (workflowId: string): void => {
  runs.delete(workflowId);
};

/**
 * Cancels every run this person has going in one conversation.
 *
 * Scoped by both, and the user id is checked rather than assumed: a workflow id
 * is a guessable-looking string in a URL, and cancelling somebody else's run
 * would be a denial of service against them.
 */
export const cancelConversationRuns = (userId: string, conversationId: string): number => {
  let cancelled = 0;

  for (const [workflowId, handle] of runs) {
    if (handle.userId !== userId || handle.conversationId !== conversationId) {
      continue;
    }

    handle.controller.abort();
    runs.delete(workflowId);
    cancelled += 1;

    log.info({ user: userId, workflow: workflowId }, 'agent run cancelled');
  }

  return cancelled;
};

/** Cancels one run, if it belongs to this person. */
export const cancelRun = (userId: string, workflowId: string): boolean => {
  const handle = runs.get(workflowId);

  if (!handle || handle.userId !== userId) {
    return false;
  }

  handle.controller.abort();
  runs.delete(workflowId);
  log.info({ user: userId, workflow: workflowId }, 'agent run cancelled');

  return true;
};

/** Workflow ids this person has running, for a status endpoint or a test. */
export const listRuns = (userId: string): string[] =>
  [...runs.entries()]
    .filter(([, handle]) => handle.userId === userId)
    .map(([workflowId]) => workflowId);

/** Testing seam: aborts and forgets everything. */
export const resetAgentRuns = (): void => {
  for (const handle of runs.values()) {
    handle.controller.abort();
  }

  runs.clear();
};
