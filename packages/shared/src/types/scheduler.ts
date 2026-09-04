import type { ScheduledJobStatus } from '../constants/scheduler.js';
import type { Entity } from './entity.js';

/**
 * One unit of work the scheduler owns.
 *
 * Jobs live in the database rather than in a timer, which is what makes the
 * schedule survive a restart: everything due is still due when the process
 * comes back, and a job interrupted mid-flight is picked up again once its
 * lease expires.
 */
export interface ScheduledJob extends Entity {
  /** Handler name, e.g. `reminder.deliver`. */
  type: string;
  /**
   * Idempotency key, unique across the collection. Two attempts to enqueue the
   * same occurrence collapse into one row, which is what stops a reminder from
   * being delivered twice.
   */
  key: string;
  payload: Record<string, unknown>;
  /** ISO-8601 UTC instant the job becomes due. */
  runAt: string;
  status: ScheduledJobStatus;
  attempts: number;
  maxAttempts: number;
  /** ISO-8601 when the current lease was taken. */
  lockedAt: string | null;
  /** Worker holding the lease. */
  lockedBy: string | null;
  lastError: string | null;
  /** ISO-8601 when the job reached a terminal state. */
  completedAt: string | null;
}

/** What one scheduler tick did, which is also what the tests assert on. */
export interface SchedulerTickResult {
  claimed: number;
  succeeded: number;
  failed: number;
  retried: number;
}
