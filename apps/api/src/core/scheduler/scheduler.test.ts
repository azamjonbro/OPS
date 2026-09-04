import { SCHEDULER_LOCK_TTL_MS } from '@hadiya/shared';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { PermanentJobError, registerJobHandler, resetJobHandlers } from './job-registry.js';
import { ScheduledJobModel, type ScheduledJobDocument } from './scheduled-job.model.js';
import { cancelJobs, claimNextJob, enqueueJob, runDueJobs } from './scheduler.service.js';

/**
 * The scheduler is tested against a real database and a controlled clock.
 *
 * No test waits for a timer: `runDueJobs` takes the instant to evaluate, so a
 * job "due tomorrow" is exercised by passing tomorrow. That is also how the
 * restart and missed-job behaviour is provoked — a job whose time passed while
 * nothing was running is just a row with a `runAt` in the past.
 */

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(async () => {
  await clearTestDatabase();
  resetJobHandlers();
});
afterEach(resetJobHandlers);

const NOW = new Date('2026-09-04T09:00:00Z');
const later = (minutes: number): Date => new Date(NOW.getTime() + minutes * 60_000);

/** Records every payload it is handed, so double execution is visible. */
const recordingHandler = (type: string) => {
  const runs: Record<string, unknown>[] = [];

  registerJobHandler(type, async (payload) => {
    runs.push(payload);
  });

  return runs;
};

const jobFor = async (key: string): Promise<ScheduledJobDocument> => {
  const job = await ScheduledJobModel.findOne({ key }).lean<ScheduledJobDocument | null>().exec();

  if (!job) {
    throw new Error(`No job stored under "${key}"`);
  }

  return job;
};

describe('enqueuing', () => {
  it('stores a job as a row rather than a timer', async () => {
    const { created, job } = await enqueueJob({
      type: 'test.run',
      key: 'test:1',
      payload: { value: 42 },
      runAt: later(10),
    });

    expect(created).toBe(true);
    expect(job).toMatchObject({ status: 'pending', attempts: 0, type: 'test.run' });
    expect(await ScheduledJobModel.countDocuments().exec()).toBe(1);
  });

  it('collapses a repeated enqueue of the same key into one job', async () => {
    await enqueueJob({ type: 'test.run', key: 'test:1', runAt: later(10) });
    const second = await enqueueJob({ type: 'test.run', key: 'test:1', runAt: later(99) });

    expect(second.created).toBe(false);
    expect(await ScheduledJobModel.countDocuments().exec()).toBe(1);
    // The original time stands: an existing job is never rewritten.
    expect((await jobFor('test:1')).runAt.toISOString()).toBe(later(10).toISOString());
  });

  it('will not resurrect a key that has already run', async () => {
    const runs = recordingHandler('test.run');

    await enqueueJob({ type: 'test.run', key: 'test:1', runAt: later(-1) });
    await runDueJobs({ now: NOW });

    // The same occurrence being queued again — a duplicate delivery attempt —
    // finds the finished row and does nothing.
    const again = await enqueueJob({ type: 'test.run', key: 'test:1', runAt: later(-1) });
    await runDueJobs({ now: NOW });

    expect(again.created).toBe(false);
    expect(runs).toHaveLength(1);
  });
});

describe('claiming', () => {
  it('takes only work that is due', async () => {
    await enqueueJob({ type: 'test.run', key: 'soon', runAt: later(-1) });
    await enqueueJob({ type: 'test.run', key: 'later', runAt: later(60) });

    const claimed = await claimNextJob(NOW);

    expect(claimed?.key).toBe('soon');
    expect(claimed?.status).toBe('running');
    expect(claimed?.attempts).toBe(1);
    expect(await claimNextJob(NOW)).toBeNull();
  });

  it('never hands the same job to two workers', async () => {
    await enqueueJob({ type: 'test.run', key: 'contested', runAt: later(-1) });

    const [first, second] = await Promise.all([claimNextJob(NOW), claimNextJob(NOW)]);
    const winners = [first, second].filter(Boolean);

    expect(winners).toHaveLength(1);
  });

  it('reclaims a job whose worker died, once the lease has expired', async () => {
    await enqueueJob({ type: 'test.run', key: 'orphan', runAt: later(-1) });

    // Claimed by a process that then vanished without finishing.
    await claimNextJob(NOW);
    expect(await claimNextJob(NOW)).toBeNull();

    const afterLease = new Date(NOW.getTime() + SCHEDULER_LOCK_TTL_MS + 1_000);
    const reclaimed = await claimNextJob(afterLease);

    expect(reclaimed?.key).toBe('orphan');
    // The dead worker's attempt still counts, so a job that kills its worker
    // cannot be retried for ever.
    expect(reclaimed?.attempts).toBe(2);
  });
});

describe('running', () => {
  it('runs work that came due while nothing was running', async () => {
    const runs = recordingHandler('test.run');

    // Queued for an hour ago; the process was down for all of it.
    await enqueueJob({ type: 'test.run', key: 'missed', payload: { n: 1 }, runAt: later(-60) });

    const result = await runDueJobs({ now: NOW });

    expect(result).toMatchObject({ claimed: 1, succeeded: 1, failed: 0, retried: 0 });
    expect(runs).toEqual([{ n: 1 }]);
    expect((await jobFor('missed')).status).toBe('succeeded');
  });

  it('leaves work that is not yet due alone', async () => {
    recordingHandler('test.run');
    await enqueueJob({ type: 'test.run', key: 'future', runAt: later(60) });

    expect(await runDueJobs({ now: NOW })).toMatchObject({ claimed: 0 });
    expect((await jobFor('future')).status).toBe('pending');

    // The same row, evaluated later, is picked up — nothing was lost by the
    // process not having been running in between.
    expect(await runDueJobs({ now: later(61) })).toMatchObject({ claimed: 1, succeeded: 1 });
  });

  it('retries a failure with a delay, then gives up and records why', async () => {
    let attempts = 0;

    registerJobHandler('test.flaky', async () => {
      attempts += 1;
      throw new Error('provider unreachable');
    });

    await enqueueJob({
      type: 'test.flaky',
      key: 'flaky',
      runAt: later(-1),
      maxAttempts: 3,
    });

    expect(await runDueJobs({ now: NOW })).toMatchObject({ retried: 1, failed: 0 });

    const afterFirst = await jobFor('flaky');
    expect(afterFirst.status).toBe('pending');
    expect(afterFirst.lastError).toBe('provider unreachable');
    // Backed off, so an immediate second pass does nothing.
    expect(afterFirst.runAt.getTime()).toBeGreaterThan(NOW.getTime());
    expect(await runDueJobs({ now: NOW })).toMatchObject({ claimed: 0 });

    await runDueJobs({ now: later(60) });
    const final = await runDueJobs({ now: later(120) });

    expect(final).toMatchObject({ failed: 1, retried: 0 });
    expect(attempts).toBe(3);
    expect(await jobFor('flaky')).toMatchObject({ status: 'failed', attempts: 3 });
  });

  it('does not retry a failure the handler calls permanent', async () => {
    let attempts = 0;

    registerJobHandler('test.broken', async () => {
      attempts += 1;
      throw new PermanentJobError('the payload is malformed');
    });

    await enqueueJob({ type: 'test.broken', key: 'broken', runAt: later(-1), maxAttempts: 5 });

    expect(await runDueJobs({ now: NOW })).toMatchObject({ failed: 1, retried: 0 });
    expect(attempts).toBe(1);
    expect(await jobFor('broken')).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('fails a job whose type nothing handles, instead of retrying for ever', async () => {
    await enqueueJob({ type: 'test.unknown', key: 'unknown', runAt: later(-1) });

    expect(await runDueJobs({ now: NOW })).toMatchObject({ failed: 1 });
    expect((await jobFor('unknown')).lastError).toMatch(/No handler is registered/);
  });

  it('processes at most one batch in a pass', async () => {
    recordingHandler('test.run');

    for (let index = 0; index < 5; index += 1) {
      await enqueueJob({ type: 'test.run', key: `bulk:${index}`, runAt: later(-1) });
    }

    expect(await runDueJobs({ now: NOW, batchSize: 2 })).toMatchObject({ claimed: 2 });
    expect(await ScheduledJobModel.countDocuments({ status: 'pending' }).exec()).toBe(3);
  });
});

describe('cancelling', () => {
  it('drops outstanding work without touching what already ran', async () => {
    const runs = recordingHandler('test.run');

    await enqueueJob({
      type: 'test.run',
      key: 'done',
      payload: { owner: 'a' },
      runAt: later(-1),
    });
    await runDueJobs({ now: NOW });

    await enqueueJob({
      type: 'test.run',
      key: 'pending',
      payload: { owner: 'a' },
      runAt: later(30),
    });

    expect(await cancelJobs({ type: 'test.run', 'payload.owner': 'a' })).toBe(1);
    expect((await jobFor('pending')).status).toBe('cancelled');
    expect((await jobFor('done')).status).toBe('succeeded');

    // A cancelled job is never picked up again.
    await runDueJobs({ now: later(60) });
    expect(runs).toHaveLength(1);
  });
});
