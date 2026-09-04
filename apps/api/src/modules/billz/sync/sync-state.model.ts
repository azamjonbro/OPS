import { model, type Model, type Types } from 'mongoose';

import { createSchema } from '../../../core/db/create-schema.js';
import { SYNC_RESOURCES, type SyncResource } from './sync.constants.js';

/**
 * Where the last successful sync of one resource got to.
 *
 * `cursor` is the value handed back to Billz to ask for "everything since" —
 * for products that is `last_updated_date`. It only moves after a run finishes
 * cleanly, so a failed run repeats the same window rather than skipping it.
 */
export interface SyncStateDocument {
  _id: Types.ObjectId;
  source: 'billz';
  resource: SyncResource;
  cursor: string | null;
  lastSyncStartedAt: Date | null;
  lastSuccessfulSyncAt: Date | null;
  lastFailedSyncAt: Date | null;
  lastError: string | null;
  /** Consecutive failures; reset by the first success. */
  consecutiveFailures: number;
  createdAt: Date;
  updatedAt: Date;
}

const syncStateSchema = createSchema<SyncStateDocument>({
  source: { type: String, required: true, enum: ['billz'] },
  resource: { type: String, required: true, enum: SYNC_RESOURCES },
  cursor: { type: String, default: null },
  lastSyncStartedAt: { type: Date, default: null },
  lastSuccessfulSyncAt: { type: Date, default: null },
  lastFailedSyncAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  consecutiveFailures: { type: Number, required: true, default: 0 },
});

// Exactly one state row per resource.
syncStateSchema.index({ source: 1, resource: 1 }, { unique: true });

export const SyncStateModel: Model<SyncStateDocument> = model<SyncStateDocument>(
  'SyncState',
  syncStateSchema,
);
