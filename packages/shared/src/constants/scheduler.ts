/**
 * A persisted job's lifecycle.
 *
 * `running` is a claim, not just a label: it carries a lease, so a worker that
 * dies mid-job releases it by letting the lease expire rather than by having to
 * clean up after itself.
 */
export const SCHEDULED_JOB_STATUSES = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
] as const;

export type ScheduledJobStatus = (typeof SCHEDULED_JOB_STATUSES)[number];

/** How often the worker looks for due jobs. */
export const SCHEDULER_POLL_INTERVAL_MS = 15_000;

/**
 * How long a claim survives without progress. A job still marked `running`
 * after this is assumed to belong to a process that died, and is claimable
 * again — which is what lets a restart recover work in flight, and what makes
 * the lease long enough that a slow but living job is not stolen from itself.
 */
export const SCHEDULER_LOCK_TTL_MS = 120_000;

/** Jobs claimed in one pass, so one tick cannot monopolise the process. */
export const SCHEDULER_BATCH_SIZE = 25;

export const SCHEDULED_JOB_MAX_ATTEMPTS = 3;

/** Finished jobs are kept this long, for auditing a delivery after the fact. */
export const SCHEDULED_JOB_RETENTION_DAYS = 30;

/**
 * Exponential back-off between attempts: 30s, 2m, 8m, capped at fifteen
 * minutes. A notification that failed because a provider was briefly down
 * should be retried soon; one failing repeatedly should back off.
 */
export const schedulerRetryDelayMs = (attempt: number): number =>
  Math.min(30_000 * 4 ** Math.max(0, attempt - 1), 15 * 60_000);
