import {
  MEMORY_STATUSES,
  MEMORY_TYPES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

const keySchema = z.string().trim().min(2).max(64);

export const createMemorySchema = z.object({
  type: z.enum(MEMORY_TYPES),
  key: keySchema,
  value: z.string().trim().min(1).max(1_000),
});

export const updateMemorySchema = z.object({
  value: z.string().trim().min(1).max(1_000),
});

export const listMemoriesQuerySchema = paginationQuerySchema.extend({
  type: z.enum(MEMORY_TYPES).optional(),
  status: z.enum(MEMORY_STATUSES).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const memoryIdParamSchema = z.object({ id: objectIdSchema });

/** Forgetting by key, for a client that knows the preference but not its id. */
export const forgetMemoryQuerySchema = z.object({
  type: z.enum(MEMORY_TYPES).optional(),
  key: keySchema,
});
