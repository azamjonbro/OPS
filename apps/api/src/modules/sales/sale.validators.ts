import {
  dateQuerySchema,
  objectIdSchema,
  paginationQuerySchema,
  SALE_PAYMENT_STATUSES,
  SALE_STATUSES,
} from '@hadiya/shared';
import { z } from 'zod';

import { salePaymentSchema } from '../payments/payment.validators.js';

const saleItemSchema = z.object({
  productId: objectIdSchema,
  quantity: z.number().finite().positive().multipleOf(0.0001),
  /** Absolute discount on the line, in minor units. */
  discount: z.number().int().min(0).optional(),
});

/**
 * Prices are deliberately absent: the server reads them from the product, so a
 * tampered client cannot decide what something costs. Only the quantity and an
 * explicit discount come from the till.
 */
export const createSaleSchema = z.object({
  branchId: objectIdSchema.nullish(),
  customerId: objectIdSchema.nullish(),
  items: z.array(saleItemSchema).min(1).max(200),
  payments: z.array(salePaymentSchema).max(5).optional(),
  note: z.string().trim().max(1000).nullish(),
  soldAt: z.coerce.date().optional(),
});

export const listSalesQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  employeeId: objectIdSchema.optional(),
  status: z.enum(SALE_STATUSES).optional(),
  paymentStatus: z.enum(SALE_PAYMENT_STATUSES).optional(),
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});

export const cancelSaleSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});

export const saleIdParamSchema = z.object({ id: objectIdSchema });

export type CreateSaleInput = z.output<typeof createSaleSchema>;
export type ListSalesQuery = z.output<typeof listSalesQuerySchema>;
