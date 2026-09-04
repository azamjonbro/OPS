import {
  SCHEDULED_JOB_MAX_ATTEMPTS,
  SCHEDULED_JOB_STATUSES,
  type ScheduledJobStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../db/create-schema.js';

/**
 * One unit of deferred work.
 *
 * Jobs are rows, not timers. A `setTimeout` lives in one process's memory: it
 * is lost on deploy, on a crash, and on the second instance never having had
 * it. A row survives all three — everything due is still due when a process
 * comes back, and any worker can pick it up.
 */
export interface ScheduledJobDocument {
  _id: Types.ObjectId;
  /** Registered handler name, e.g. `reminder.deliver`. */
  type: string;
  /**
   * Idempotency key. Unique across the collection, so enqueuing the same piece
   * of work twice collapses into one row instead of two deliveries.
   */
  key: string;
  payload: Record<string, unknown>;
  runAt: Date;
  status: ScheduledJobStatus;
  attempts: number;
  maxAttempts: number;
  /** When the current lease was taken; a stale lease is reclaimable. */
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledJobSchema = createSchema<ScheduledJobDocument>({
  type: { type: String, required: true, trim: true, maxlength: 80 },
  key: { type: String, required: true, trim: true, maxlength: 200 },
  payload: { type: Schema.Types.Mixed, required: true, default: {} },
  runAt: { type: Date, required: true },
  status: { type: String, required: true, enum: SCHEDULED_JOB_STATUSES, default: 'pending' },
  attempts: { type: Number, required: true, default: 0, min: 0 },
  maxAttempts: { type: Number, required: true, default: SCHEDULED_JOB_MAX_ATTEMPTS, min: 1 },
  lockedAt: { type: Date, default: null },
  lockedBy: { type: String, default: null },
  lastError: { type: String, default: null },
  completedAt: { type: Date, default: null },
});

/**
 * The guarantee the whole design rests on: one row per key, enforced by the
 * database rather than by a check-then-insert that two workers could both pass.
 */
scheduledJobSchema.index({ key: 1 }, { unique: true });
// The claim query: due work, oldest first.
scheduledJobSchema.index({ status: 1, runAt: 1 });
// Reclaiming leases abandoned by a process that died.
scheduledJobSchema.index({ status: 1, lockedAt: 1 });
// Cancelling every outstanding job for one reminder.
scheduledJobSchema.index({ type: 1, status: 1 });

export const ScheduledJobModel: Model<ScheduledJobDocument> = model<ScheduledJobDocument>(
  'ScheduledJob',
  scheduledJobSchema,
);
