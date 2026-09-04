import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../../core/db/create-schema.js';
import { SYNC_MODES, SYNC_RESOURCES, SYNC_RUN_STATUSES } from './sync.constants.js';
import type { SyncMode, SyncResource, SyncRunStatus } from './sync.constants.js';

/**
 * One record per sync run, kept whether it succeeded or not.
 *
 * This is the operator's answer to "did last night's sync work, and what did it
 * change?" — so it records counts rather than the records themselves, and the
 * error message when there was one.
 */
export interface SyncLogDocument {
  _id: Types.ObjectId;
  source: 'billz';
  resource: SyncResource;
  mode: SyncMode;
  status: SyncRunStatus;
  startedAt: Date;
  finishedAt: Date | null;
  durationMs: number | null;
  /** The window this run asked Billz for; `null` on a full sync. */
  cursorBefore: string | null;
  cursorAfter: string | null;
  counts: {
    fetched: number;
    created: number;
    updated: number;
    unchanged: number;
    skipped: number;
    failed: number;
  };
  error: string | null;
  /** Employee who triggered it, or `null` for a scheduled run. */
  triggeredBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const countsSchema = new Schema<SyncLogDocument['counts']>(
  {
    fetched: { type: Number, required: true, default: 0 },
    created: { type: Number, required: true, default: 0 },
    updated: { type: Number, required: true, default: 0 },
    unchanged: { type: Number, required: true, default: 0 },
    skipped: { type: Number, required: true, default: 0 },
    failed: { type: Number, required: true, default: 0 },
  },
  { _id: false },
);

const syncLogSchema = createSchema<SyncLogDocument>({
  source: { type: String, required: true, enum: ['billz'] },
  resource: { type: String, required: true, enum: SYNC_RESOURCES },
  mode: { type: String, required: true, enum: SYNC_MODES },
  status: { type: String, required: true, enum: SYNC_RUN_STATUSES },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, default: null },
  durationMs: { type: Number, default: null },
  cursorBefore: { type: String, default: null },
  cursorAfter: { type: String, default: null },
  counts: { type: countsSchema, required: true },
  error: { type: String, default: null },
  triggeredBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

// The run history for one resource, newest first — the only way it is read.
syncLogSchema.index({ source: 1, resource: 1, startedAt: -1 });

export const SyncLogModel: Model<SyncLogDocument> = model<SyncLogDocument>(
  'SyncLog',
  syncLogSchema,
);
