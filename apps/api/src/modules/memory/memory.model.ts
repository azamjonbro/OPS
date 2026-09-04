import {
  MEMORY_SOURCES,
  MEMORY_STATUSES,
  MEMORY_TYPES,
  type MemorySource,
  type MemoryStatus,
  type MemoryType,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One durable fact about a person.
 *
 * Identity is `(user, type, key)`: learning the same preference twice updates
 * the value instead of leaving two answers to the same question. Forgetting
 * sets `status: 'deleted'` rather than removing the row, so a memory that was
 * dropped cannot quietly come back the next time it is mentioned.
 */
export interface MemoryDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: MemoryType;
  key: string;
  value: string;
  source: MemorySource;
  status: MemoryStatus;
  confidence: number;
  conversation: Types.ObjectId | null;
  lastUsedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const memorySchema = createSchema<MemoryDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true, enum: MEMORY_TYPES },
  key: { type: String, required: true, trim: true, lowercase: true, maxlength: 64 },
  value: { type: String, required: true, trim: true, maxlength: 1_000 },
  source: { type: String, required: true, enum: MEMORY_SOURCES },
  status: { type: String, required: true, enum: MEMORY_STATUSES, default: 'active' },
  confidence: { type: Number, required: true, min: 0, max: 1, default: 1 },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
  lastUsedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null },
});

// One live answer per question. The partial filter lets a forgotten memory keep
// its row while a new one takes the same key.
memorySchema.index(
  { user: 1, type: 1, key: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ['active', 'pending'] } } },
);
// Building a prompt reads "this user's active memories, most useful first".
memorySchema.index({ user: 1, status: 1, updatedAt: -1 });

export const MemoryModel: Model<MemoryDocument> = model<MemoryDocument>('Memory', memorySchema);
