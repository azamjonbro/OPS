import {
  dateQuerySchema,
  INVENTORY_MOVEMENT_TYPES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * Movement types a person may record directly. `sale`, `transfer_in` and
 * `transfer_out` are written by the sale and transfer flows, which keeps the
 * stock card consistent with the documents that caused it.
 */
export const MANUAL_MOVEMENT_TYPES = [
  'purchase',
  'return',
  'adjustment',
] as const satisfies ReadonlyArray<(typeof INVENTORY_MOVEMENT_TYPES)[number]>;

/** Four decimals is enough for weighed goods and keeps rounding predictable. */
const quantitySchema = z.number().finite().multipleOf(0.0001);

export const recordMovementSchema = z.object({
  productId: objectIdSchema,
  branchId: objectIdSchema.nullish(),
  type: z.enum(MANUAL_MOVEMENT_TYPES),
  /** Signed for an adjustment; a magnitude for the rest. */
  quantity: quantitySchema.refine((value) => value !== 0, 'Quantity cannot be zero'),
  note: z.string().trim().max(500).nullish(),
  occurredAt: z.coerce.date().optional(),
});

export const transferStockSchema = z.object({
  productId: objectIdSchema,
  fromBranchId: objectIdSchema,
  toBranchId: objectIdSchema,
  quantity: quantitySchema.positive(),
  note: z.string().trim().max(500).nullish(),
});

export const listStockQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  /** Stock at or below this level — the reorder view. */
  maxQuantity: z.coerce.number().min(0).optional(),
});

export const listMovementsQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  productId: objectIdSchema.optional(),
  type: z.enum(INVENTORY_MOVEMENT_TYPES).optional(),
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});

export type RecordMovementBody = z.output<typeof recordMovementSchema>;
export type TransferStockBody = z.output<typeof transferStockSchema>;
export type ListStockQuery = z.output<typeof listStockQuerySchema>;
export type ListMovementsQuery = z.output<typeof listMovementsQuerySchema>;
