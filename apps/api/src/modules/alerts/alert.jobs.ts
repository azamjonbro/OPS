import {
  ALERT_EVALUATION_INTERVAL_MS,
  ALERT_EVALUATION_JOB_TYPE,
  type AuthenticatedUser,
} from '@hadiya/shared';

import { createLogger } from '../../core/logger/logger.js';
import { enqueueJob, PermanentJobError, registerJobHandler } from '../../core/scheduler/index.js';
import { UserModel } from '../users/user.model.js';
import { evaluateForActor } from './alert.evaluator.js';

const log = createLogger('alert-jobs');

/**
 * The seam between the scheduler and alert evaluation.
 *
 * Nothing about scheduling lives in the alert services and nothing about alerts
 * lives in the scheduler; this file is registered at start-up and is the only
 * thing that knows about both — the same shape the reminder jobs already use.
 *
 * The job re-enqueues itself at the end of a successful run rather than being
 * driven by a cron expression. That keeps the whole thing inside the existing
 * job table, which is what buys restart safety, the single-claim guarantee and
 * bounded retries for free: an evaluation that dies with its process is picked
 * up by the next worker when its lease goes stale, and one that fails because
 * Billz was briefly down is retried with backoff rather than skipped.
 */

/**
 * A job key that changes every interval.
 *
 * `enqueueJob` only ever inserts, so a fixed key would enqueue the first
 * evaluation and then silently refuse every one after it. Bucketing the due
 * time makes each cycle its own row while still collapsing two workers racing
 * to schedule the same cycle into one.
 */
export const evaluationJobKey = (userId: string, runAt: Date): string =>
  `${ALERT_EVALUATION_JOB_TYPE}:${userId}:${Math.floor(runAt.getTime() / ALERT_EVALUATION_INTERVAL_MS)}`;

/** Puts the next evaluation for one account on the queue. */
export const scheduleEvaluation = async (
  userId: string,
  runAt: Date,
): Promise<{ created: boolean }> => {
  const { created } = await enqueueJob({
    type: ALERT_EVALUATION_JOB_TYPE,
    key: evaluationJobKey(userId, runAt),
    payload: { userId },
    runAt,
  });

  return { created };
};

/**
 * Rebuilds the principal the evaluation runs as.
 *
 * Read from the database on every run rather than carried in the payload. A
 * payload is written once and then acts for as long as the job survives, so an
 * account that has since been disabled, moved branch or changed timezone would
 * go on being evaluated under its old identity — and branch scope is exactly
 * the thing that must never go stale.
 */
const loadActor = async (userId: string): Promise<AuthenticatedUser | null> => {
  const user = await UserModel.findById(userId).lean().exec();

  if (!user || user.status !== 'active') {
    return null;
  }

  return {
    id: String(user._id),
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    branchId: user.branch ? String(user.branch) : null,
    timezone: user.timezone,
  };
};

export const registerAlertJobs = (): void => {
  registerJobHandler(ALERT_EVALUATION_JOB_TYPE, async (payload, { now }) => {
    const userId = typeof payload.userId === 'string' ? payload.userId : null;

    if (!userId) {
      // A retry carries the same broken payload, so there is nothing to wait for.
      throw new PermanentJobError('The alert evaluation payload is missing a user id');
    }

    const actor = await loadActor(userId);

    if (!actor) {
      // The account is gone or disabled. Not an error, and not something to
      // reschedule: the chain simply ends here.
      log.debug({ userId }, 'alert evaluation skipped for an inactive account');

      return;
    }

    try {
      await evaluateForActor(actor, now);
    } finally {
      // Scheduled in `finally` so a failed evaluation does not end the chain.
      // The scheduler retries the failed run on its own backoff; this makes
      // sure the *next* cycle happens either way, so one bad hour — Billz
      // briefly down — cannot silently switch alerting off for an account.
      await scheduleEvaluation(userId, new Date(now.getTime() + ALERT_EVALUATION_INTERVAL_MS));
    }
  });
};

/**
 * Puts every active account on the queue at start-up.
 *
 * Idempotent by construction: the job key collapses repeats within a cycle, so
 * a restart — or a second instance booting — schedules nothing twice.
 */
export const scheduleAlertEvaluations = async (now: Date = new Date()): Promise<number> => {
  const users = await UserModel.find({ status: 'active' }).select('_id').lean().exec();
  let scheduled = 0;

  for (const user of users) {
    const { created } = await scheduleEvaluation(String(user._id), now);

    if (created) {
      scheduled += 1;
    }
  }

  if (scheduled > 0) {
    log.info({ scheduled }, 'alert evaluations scheduled');
  }

  return scheduled;
};
