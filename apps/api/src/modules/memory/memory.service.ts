import {
  buildPaginationMeta,
  isObjectIdString,
  MEMORY_CONFIRMATION_THRESHOLD,
  resolvePagination,
  type AuthenticatedUser,
  type MemorySource,
  type MemoryStatus,
  type MemoryType,
  type PaginatedResult,
} from '@hadiya/shared';

import { toObjectId, toObjectIdOrNull } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { MemoryModel, type MemoryDocument } from './memory.model.js';
import { classifySensitivity, sensitivityMessage } from './memory-privacy.js';

/**
 * Long-term memory, scoped to one person.
 *
 * Every query filters on the actor's id, so a memory cannot be read, changed or
 * forgotten across accounts — the filter is the authorisation, not a check
 * performed after the fact.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

/** Keys are machine-readable so the same idea always lands on the same memory. */
const normaliseKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 64);

export interface RememberInput {
  type: MemoryType;
  key: string;
  value: string;
  source: MemorySource;
  /** 0–1. Below the threshold the memory is held for confirmation. */
  confidence?: number;
  conversationId?: string | null;
}

export interface RememberResult {
  memory: MemoryDocument | null;
  /** `saved`, `pending_confirmation`, or `refused` when it held a secret. */
  outcome: 'saved' | 'pending_confirmation' | 'refused';
  message: string;
}

/**
 * Stores a fact, or refuses to.
 *
 * Three things can happen, and the caller is told which. A credential is
 * refused outright. Anything the assistant is not confident about is kept as
 * `pending` and is not used in prompts until a person confirms it. Everything
 * else is saved, replacing whatever that key held before.
 */
export const remember = async (
  actor: AuthenticatedUser,
  input: RememberInput,
): Promise<RememberResult> => {
  const key = normaliseKey(input.key);

  if (key.length === 0) {
    throw ApiError.badRequest('A memory key is required');
  }

  const value = input.value.trim();

  if (value.length === 0) {
    throw ApiError.badRequest('A memory value is required');
  }

  const verdict = classifySensitivity(key, value);

  if (verdict.sensitive && verdict.reason) {
    // Nothing is written — not even a redacted placeholder, which would still
    // record that the person has that credential.
    return { memory: null, outcome: 'refused', message: sensitivityMessage(verdict.reason) };
  }

  const confidence = input.confidence ?? 1;
  const status: MemoryStatus =
    input.source === 'user' || confidence >= MEMORY_CONFIRMATION_THRESHOLD ? 'active' : 'pending';

  const updated = await MemoryModel.findOneAndUpdate(
    ownedBy(actor, { type: input.type, key, status: { $in: ['active', 'pending'] } }),
    {
      $set: {
        value,
        source: input.source,
        status,
        confidence,
        // Provenance only: an unusable id drops the link rather than failing
        // the save, since where a memory was learned is not what makes it valid.
        conversation: isObjectIdString(input.conversationId)
          ? toObjectIdOrNull(input.conversationId)
          : null,
        deletedAt: null,
      },
      $setOnInsert: { user: toObjectId(actor.id), type: input.type, key },
    },
    { returnDocument: 'after', upsert: true, runValidators: true },
  )
    .lean<MemoryDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.internal('The memory could not be saved');
  }

  return {
    memory: updated,
    outcome: status === 'pending' ? 'pending_confirmation' : 'saved',
    message:
      status === 'pending'
        ? 'Saved for confirmation; it will not be used until you confirm it.'
        : 'Remembered.',
  };
};

export interface ListMemoriesQuery {
  page: number;
  pageSize: number;
  type?: MemoryType | undefined;
  status?: MemoryStatus | undefined;
  search?: string | undefined;
}

export const listMemories = async (
  actor: AuthenticatedUser,
  query: ListMemoriesQuery,
): Promise<PaginatedResult<MemoryDocument>> => {
  const filter: Record<string, unknown> = ownedBy(actor, {
    // Forgotten memories stay out of every list unless asked for by name.
    status: query.status ?? { $in: ['active', 'pending'] },
  });

  if (query.type) {
    filter.type = query.type;
  }

  if (query.search) {
    filter.$or = [
      { key: { $regex: query.search, $options: 'i' } },
      { value: { $regex: query.search, $options: 'i' } },
    ];
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    MemoryModel.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<MemoryDocument[]>()
      .exec(),
    MemoryModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

/** Active memories only — what the context builder is allowed to use. */
export const listActiveMemories = async (
  actor: AuthenticatedUser,
  limit: number,
): Promise<MemoryDocument[]> =>
  MemoryModel.find(ownedBy(actor, { status: 'active' }))
    .sort({ updatedAt: -1 })
    .limit(limit)
    .lean<MemoryDocument[]>()
    .exec();

export const getMemory = async (actor: AuthenticatedUser, id: string): Promise<MemoryDocument> => {
  const memory = await MemoryModel.findOne(ownedBy(actor, { _id: id }))
    .lean<MemoryDocument | null>()
    .exec();

  if (!memory) {
    throw ApiError.notFound('Memory not found');
  }

  return memory;
};

/** Looks a memory up the way the assistant refers to it: by type and key. */
export const findByKey = async (
  actor: AuthenticatedUser,
  type: MemoryType,
  key: string,
): Promise<MemoryDocument | null> =>
  MemoryModel.findOne(
    ownedBy(actor, { type, key: normaliseKey(key), status: { $in: ['active', 'pending'] } }),
  )
    .lean<MemoryDocument | null>()
    .exec();

/**
 * Forgetting. The row survives with a `deleted` status and a timestamp, so the
 * unique index frees the key for a new answer while the history of what was
 * dropped is not silently rewritten.
 */
export const forget = async (
  actor: AuthenticatedUser,
  selector: { id?: string; type?: MemoryType; key?: string },
): Promise<{ forgotten: number }> => {
  const filter: Record<string, unknown> = ownedBy(actor, {
    status: { $in: ['active', 'pending'] },
  });

  if (selector.id) {
    filter._id = selector.id;
  }

  if (selector.type) {
    filter.type = selector.type;
  }

  if (selector.key) {
    filter.key = normaliseKey(selector.key);
  }

  if (!selector.id && !selector.key) {
    throw ApiError.badRequest('Forgetting needs a memory id or a key');
  }

  const result = await MemoryModel.updateMany(filter, {
    $set: { status: 'deleted', deletedAt: new Date() },
  }).exec();

  return { forgotten: result.modifiedCount };
};

/** Promotes a pending memory once a person has confirmed it. */
export const confirmMemory = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<MemoryDocument> => {
  const updated = await MemoryModel.findOneAndUpdate(
    ownedBy(actor, { _id: id, status: 'pending' }),
    { $set: { status: 'active', confidence: 1, source: 'user' } },
    { returnDocument: 'after' },
  )
    .lean<MemoryDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('No memory is waiting for confirmation under that id');
  }

  return updated;
};

/** Records that a memory was used, which later drives relevance ordering. */
export const markMemoriesUsed = async (actor: AuthenticatedUser, ids: string[]): Promise<void> => {
  if (ids.length === 0) {
    return;
  }

  await MemoryModel.updateMany(ownedBy(actor, { _id: { $in: ids } }), {
    $set: { lastUsedAt: new Date() },
  }).exec();
};
