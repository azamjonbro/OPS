import { randomUUID } from 'node:crypto';

import {
  SCHEDULED_JOB_MAX_ATTEMPTS,
  SCHEDULED_JOB_RETENTION_DAYS,
  SCHEDULER_BATCH_SIZE,
  SCHEDULER_LOCK_TTL_MS,
  SCHEDULER_POLL_INTERVAL_MS,
  schedulerRetryDelayMs,
  type SchedulerTickResult,
} from '@hadiya/shared';

import { createLogger } from '../logger/logger.js';
import { getJobHandler, PermanentJobError } from './job-registry.js';
import { ScheduledJobModel, type ScheduledJobDocument } from './scheduled-job.model.js';

const log = createLogger('scheduler');

/**
 * The worker that runs persisted jobs.
 *
 * Four properties matter, and each one is bought by a specific mechanism rather
 * than by hoping:
 *
 * - *No duplicate execution.* Claiming is a single atomic `findOneAndUpdate`
 *   that flips `pending` to `running`. Two workers racing for the same row
 *   produce one winner and one `null`; there is no read-then-write window
 *   between them.
 * - *Restart safety.* Jobs are rows with a due time, so a process that dies
 *   loses nothing. Work that was in flight is marked `running` with a lease,
 *   and once the lease goes stale another pass reclaims it.
 * - *Missed work.* The claim asks for everything due *at or before* now, not
 *   for what is due this instant, so an outage is caught up on the next tick
 *   instead of being silently skipped.
 * - *Bounded retries.* A failed attempt goes back to `pending` with an
 *   exponential delay until the attempt budget runs out, and a failure the
 *   handler calls permanent skips the remaining attempts entirely.
 */

/** Identifies this process in a lease, which is what makes a stuck job traceable. */
const WORKER_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export interface EnqueueJobInput {
  type: string;
  /** Idempotency key. The same key never produces a second execution. */
  key: string;
  payload?: Record<string, unknown>;
  runAt: Date;
  maxAttempts?: number;
}

export interface EnqueueResult {
  job: ScheduledJobDocument;
  /** False when a row for this key already existed and was left alone. */
  created: boolean;
}

/**
 * Puts a job in the queue, once.
 *
 * The upsert only ever *inserts*: an existing row for the key — pending,
 * running or long finished — is returned untouched. That is deliberate. If a
 * caller could update a key back to `pending`, an already-delivered reminder
 * could be delivered a second time, which is the failure this whole key exists
 * to prevent.
 */
export const enqueueJob = async (input: EnqueueJobInput): Promise<EnqueueResult> => {
  const existing = await ScheduledJobModel.findOne({ key: input.key })
    .lean<ScheduledJobDocument | null>()
    .exec();

  if (existing) {
    return { job: existing, created: false };
  }

  try {
    const created = await ScheduledJobModel.create({
      type: input.type,
      key: input.key,
      payload: input.payload ?? {},
      runAt: input.runAt,
      status: 'pending',
      attempts: 0,
      maxAttempts: input.maxAttempts ?? SCHEDULED_JOB_MAX_ATTEMPTS,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      completedAt: null,
    });

    return { job: created.toObject<ScheduledJobDocument>(), created: true };
  } catch (error) {
    // Two callers raced; the unique index settled it. Whoever lost reads the
    // winner's row rather than reporting a failure.
    const raced = await ScheduledJobModel.findOne({ key: input.key })
      .lean<ScheduledJobDocument | null>()
      .exec();

    if (raced) {
      return { job: raced, created: false };
    }

    throw error;
  }
};

/** Drops outstanding jobs, e.g. every pending delivery of a cancelled reminder. */
export const cancelJobs = async (filter: Record<string, unknown>): Promise<number> => {
  const result = await ScheduledJobModel.updateMany(
    { ...filter, status: { $in: ['pending', 'running'] } },
    { $set: { status: 'cancelled', completedAt: new Date(), lockedAt: null, lockedBy: null } },
  ).exec();

  return result.modifiedCount;
};

export const findJob = async (key: string): Promise<ScheduledJobDocument | null> =>
  ScheduledJobModel.findOne({ key }).lean<ScheduledJobDocument | null>().exec();

/**
 * Takes exclusive ownership of one due job, or returns `null` when there is
 * nothing to do.
 *
 * The filter is the interesting part. It matches two populations: work that is
 * due and unclaimed, and work claimed by a lease that has since gone stale —
 * which is how a job orphaned by a crashed process comes back. `attempts` is
 * incremented as part of the claim, so a job that kills its worker outright
 * still counts as having been tried and cannot be retried forever.
 */
export const claimNextJob = async (now: Date): Promise<ScheduledJobDocument | null> => {
  const staleBefore = new Date(now.getTime() - SCHEDULER_LOCK_TTL_MS);

  return ScheduledJobModel.findOneAndUpdate(
    {
      $or: [
        { status: 'pending', runAt: { $lte: now } },
        { status: 'running', lockedAt: { $lte: staleBefore } },
      ],
    },
    {
      $set: { status: 'running', lockedAt: now, lockedBy: WORKER_ID },
      $inc: { attempts: 1 },
    },
    { sort: { runAt: 1 }, returnDocument: 'after' },
  )
    .lean<ScheduledJobDocument | null>()
    .exec();
};

const completeJob = async (job: ScheduledJobDocument, now: Date): Promise<void> => {
  await ScheduledJobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'succeeded',
        completedAt: now,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      },
    },
  ).exec();
};

/** Returns whether the job will be tried again. */
const failJob = async (
  job: ScheduledJobDocument,
  error: unknown,
  now: Date,
): Promise<{ retried: boolean }> => {
  const message = error instanceof Error ? error.message : String(error);
  const permanent = error instanceof PermanentJobError;
  const exhausted = job.attempts >= job.maxAttempts;

  if (permanent || exhausted) {
    await ScheduledJobModel.updateOne(
      { _id: job._id },
      {
        $set: {
          status: 'failed',
          completedAt: now,
          lockedAt: null,
          lockedBy: null,
          lastError: message,
        },
      },
    ).exec();

    log.warn(
      { jobKey: job.key, type: job.type, attempts: job.attempts, permanent },
      'scheduled job failed',
    );

    return { retried: false };
  }

  const retryAt = new Date(now.getTime() + schedulerRetryDelayMs(job.attempts));

  await ScheduledJobModel.updateOne(
    { _id: job._id },
    {
      $set: {
        status: 'pending',
        runAt: retryAt,
        lockedAt: null,
        lockedBy: null,
        lastError: message,
      },
    },
  ).exec();

  log.warn(
    { jobKey: job.key, type: job.type, attempt: job.attempts, retryAt },
    'scheduled job will be retried',
  );

  return { retried: true };
};

/** Runs one claimed job and records how it ended. */
export const runJob = async (
  job: ScheduledJobDocument,
  now: Date,
): Promise<'succeeded' | 'failed' | 'retried'> => {
  const handler = getJobHandler(job.type);

  if (!handler) {
    // Nothing will make an unregistered type run, so retrying is pointless.
    await failJob(job, new PermanentJobError(`No handler is registered for "${job.type}"`), now);

    return 'failed';
  }

  try {
    await handler(job.payload, { job, now });
    await completeJob(job, now);

    return 'succeeded';
  } catch (error) {
    const { retried } = await failJob(job, error, now);

    return retried ? 'retried' : 'failed';
  }
};

export interface RunDueJobsOptions {
  now?: Date;
  batchSize?: number;
}

/**
 * One pass of the queue. Tests drive this directly with a chosen `now` instead
 * of waiting for a timer, so scheduling behaviour is asserted without any real
 * time passing.
 */
export const runDueJobs = async (options: RunDueJobsOptions = {}): Promise<SchedulerTickResult> => {
  const now = options.now ?? new Date();
  const batchSize = options.batchSize ?? SCHEDULER_BATCH_SIZE;
  const result: SchedulerTickResult = { claimed: 0, succeeded: 0, failed: 0, retried: 0 };

  for (let processed = 0; processed < batchSize; processed += 1) {
    const job = await claimNextJob(now);

    if (!job) {
      break;
    }

    result.claimed += 1;

    const outcome = await runJob(job, now);

    if (outcome === 'succeeded') {
      result.succeeded += 1;
    } else if (outcome === 'retried') {
      result.retried += 1;
    } else {
      result.failed += 1;
    }
  }

  return result;
};

/** Clears out finished jobs so the collection does not grow without bound. */
export const purgeFinishedJobs = async (now: Date = new Date()): Promise<number> => {
  const cutoff = new Date(now.getTime() - SCHEDULED_JOB_RETENTION_DAYS * 86_400_000);
  const result = await ScheduledJobModel.deleteMany({
    status: { $in: ['succeeded', 'cancelled'] },
    completedAt: { $lte: cutoff },
  }).exec();

  return result.deletedCount;
};

let timer: NodeJS.Timeout | null = null;
let ticking = false;

export interface StartSchedulerOptions {
  pollIntervalMs?: number;
  batchSize?: number;
}

/**
 * Starts the polling loop.
 *
 * A tick that is still running blocks the next one rather than queueing behind
 * it: overlapping passes would claim each other's stale leases under load, and
 * there is nothing to gain from starting a second pass while the first is still
 * draining the same queue.
 */
export const startScheduler = (options: StartSchedulerOptions = {}): void => {
  if (timer) {
    return;
  }

  const pollIntervalMs = options.pollIntervalMs ?? SCHEDULER_POLL_INTERVAL_MS;

  const tick = async (): Promise<void> => {
    if (ticking) {
      return;
    }

    ticking = true;

    try {
      const result = await runDueJobs({ batchSize: options.batchSize ?? SCHEDULER_BATCH_SIZE });

      if (result.claimed > 0) {
        log.info(result, 'scheduler tick completed');
      }
    } catch (error) {
      // A failure here is the loop itself breaking (the database is gone, say),
      // not a job failing. It must never stop the interval.
      log.error({ err: error }, 'scheduler tick failed');
    } finally {
      ticking = false;
    }
  };

  timer = setInterval(() => void tick(), pollIntervalMs);
  // The loop must not be the reason the process refuses to exit.
  timer.unref();

  log.info({ workerId: WORKER_ID, pollIntervalMs }, 'scheduler started');

  // Catch up on anything that came due while the process was down, without
  // waiting a full interval first.
  void tick();
};

export const stopScheduler = async (): Promise<void> => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }

  // Let an in-flight tick finish so a job is not abandoned mid-handler; its
  // lease would cover it, but a clean stop is cheaper than a lease timeout.
  for (let waited = 0; ticking && waited < 50; waited += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};

export const isSchedulerRunning = (): boolean => timer !== null;

export const schedulerWorkerId = (): string => WORKER_ID;
