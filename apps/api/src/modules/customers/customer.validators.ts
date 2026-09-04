import {
  booleanQuerySchema,
  CUSTOMER_STATUSES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, 'Must be a valid phone number');

export const createCustomerSchema = z.object({
  fullName: z.string().trim().min(2).max(160),
  phone: phoneSchema,
  notes: z.string().trim().max(2000).nullish(),
  branchId: objectIdSchema.nullish(),
});

export const updateCustomerSchema = z
  .object({
    fullName: z.string().trim().min(2).max(160),
    phone: phoneSchema,
    notes: z.string().trim().max(2000).nullable(),
    status: z.enum(CUSTOMER_STATUSES),
    branchId: objectIdSchema.nullable(),
  })
  .partial();

export const listCustomersQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  status: z.enum(CUSTOMER_STATUSES).optional(),
  /** Matches name or phone. */
  search: z.string().trim().min(1).max(80).optional(),
  /** Only customers who still owe money. */
  withDebt: booleanQuerySchema.optional(),
});

export const customerIdParamSchema = z.object({ id: objectIdSchema });

export type CreateCustomerInput = z.output<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.output<typeof updateCustomerSchema>;
export type ListCustomersQuery = z.output<typeof listCustomersQuerySchema>;
