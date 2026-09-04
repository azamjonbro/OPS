import { dateQuerySchema, paginationQuerySchema } from '@hadiya/shared';
import { z } from 'zod';

import { SYNC_MODES, SYNC_RESOURCES } from './sync/sync.constants.js';

/** Billz ids are opaque strings, so they are length-checked rather than parsed. */
const externalIdSchema = z.string().trim().min(1).max(64);

const searchSchema = z.string().trim().min(1).max(80);

export const billzProductQuerySchema = paginationQuerySchema.extend({
  search: searchSchema.optional(),
  /** ISO-8601; passes straight through to Billz's `last_updated_date`. */
  updatedSince: dateQuerySchema.optional(),
});

export const billzCustomerQuerySchema = paginationQuerySchema.extend({
  search: searchSchema.optional(),
  phone: z.string().trim().min(4).max(32).optional(),
});

/**
 * Billz's order search demands a bounded window, so `from` and `to` are
 * required rather than defaulted — an unbounded date range would walk the whole
 * receipt history on every call.
 */
export const billzSalesQuerySchema = z
  .object({
    from: dateQuerySchema,
    to: dateQuerySchema,
    shopIds: z
      .string()
      .trim()
      .min(1)
      .optional()
      .transform((value) => (value ? value.split(',').map((entry) => entry.trim()) : undefined)),
    limit: z.coerce.number().int().min(1).max(2_000).optional(),
  })
  .refine((value) => value.from <= value.to, '`from` must not be after `to`');

export const billzPeriodQuerySchema = z
  .object({ from: dateQuerySchema, to: dateQuerySchema })
  .refine((value) => value.from <= value.to, '`from` must not be after `to`');

export const billzInventoryQuerySchema = z.object({
  shopId: externalIdSchema.optional(),
  maxQuantity: z.coerce.number().min(0).optional(),
  search: searchSchema.optional(),
});

export const billzExternalIdParamSchema = z.object({ externalId: externalIdSchema });

export const startSyncSchema = z.object({
  mode: z.enum(SYNC_MODES).default('incremental'),
  /** Omit to sync every resource in dependency order. */
  resource: z.enum(SYNC_RESOURCES).optional(),
});

export const syncLogQuerySchema = z.object({
  resource: z.enum(SYNC_RESOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type BillzProductQuery = z.output<typeof billzProductQuerySchema>;
export type BillzSalesQuery = z.output<typeof billzSalesQuerySchema>;
