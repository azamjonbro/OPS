import type { ScheduledJobDocument } from './scheduled-job.model.js';

/**
 * What a handler is given alongside its payload.
 *
 * `now` is the instant the scheduler is evaluating, not the wall clock. A
 * handler that read the clock itself would be untestable — and worse, would
 * disagree with the pass that claimed it about what time it is, which for
 * anything that computes a *next* occurrence is the difference between
 * scheduling tomorrow and scheduling a hundred deliveries in a loop.
 */
export interface JobContext {
  job: ScheduledJobDocument;
  now: Date;
}

export type JobHandler = (payload: Record<string, unknown>, context: JobContext) => Promise<void>;

/**
 * A failure the job should not be retried for.
 *
 * Retrying is right for a provider that was briefly down and wrong for a
 * malformed payload: the second attempt is malformed too, and the only thing
 * the retries buy is delay before the same conclusion. Handlers say which kind
 * of failure they hit by throwing this or a plain error.
 */
export class PermanentJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentJobError';
  }
}

/**
 * The single place a job type is turned into code — the same rule the AI tool
 * registry follows. A job whose type is not registered is failed permanently
 * rather than retried forever against a handler that will never exist.
 */
const handlers = new Map<string, JobHandler>();

export const registerJobHandler = (type: string, handler: JobHandler): void => {
  if (handlers.has(type)) {
    throw new Error(`A handler for job type "${type}" is already registered`);
  }

  handlers.set(type, handler);
};

export const getJobHandler = (type: string): JobHandler | undefined => handlers.get(type);

export const registeredJobTypes = (): string[] => [...handlers.keys()];

/** Testing seam: lets a suite install its own handlers. */
export const resetJobHandlers = (): void => {
  handlers.clear();
};
