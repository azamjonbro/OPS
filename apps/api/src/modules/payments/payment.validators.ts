import {
  dateQuerySchema,
  objectIdSchema,
  paginationQuerySchema,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} from '@hadiya/shared';
import { z } from 'zod';

/** Minor units; a payment of zero is not an event worth recording. */
const amountSchema = z.number().int().positive();

export const recordPaymentSchema = z
  .object({
    saleId: objectIdSchema.nullish(),
    customerId: objectIdSchema.nullish(),
    branchId: objectIdSchema.nullish(),
    amount: amountSchema,
    method: z.enum(PAYMENT_METHODS),
    reference: z.string().trim().max(120).nullish(),
    paidAt: z.coerce.date().optional(),
  })
  .refine(
    (value) => Boolean(value.saleId) || Boolean(value.customerId),
    'A payment must reference either a sale or a customer',
  );

/** A payment taken as part of ringing up a sale. */
export const salePaymentSchema = z.object({
  amount: amountSchema,
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).nullish(),
});

export const listPaymentsQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  saleId: objectIdSchema.optional(),
  customerId: objectIdSchema.optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});

export const paymentIdParamSchema = z.object({ id: objectIdSchema });

export type RecordPaymentInput = z.output<typeof recordPaymentSchema>;
export type SalePaymentInput = z.output<typeof salePaymentSchema>;
export type ListPaymentsQuery = z.output<typeof listPaymentsQuerySchema>;
