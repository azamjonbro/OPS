import {
  dateQuerySchema,
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

export const createExpenseSchema = z.object({
  branchId: objectIdSchema.nullish(),
  category: z.enum(EXPENSE_CATEGORIES),
  /** Minor units. */
  amount: z.number().int().positive(),
  description: z.string().trim().max(1000).nullish(),
  date: z.coerce.date().optional(),
});

export const updateExpenseSchema = z
  .object({
    category: z.enum(EXPENSE_CATEGORIES),
    amount: z.number().int().positive(),
    description: z.string().trim().max(1000).nullable(),
    date: z.coerce.date(),
  })
  .partial();

/** Review decisions a supervisor can record; `pending` is the starting state. */
export const reviewExpenseSchema = z.object({
  status: z.enum(EXPENSE_STATUSES).exclude(['pending']),
});

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  status: z.enum(EXPENSE_STATUSES).optional(),
  createdById: objectIdSchema.optional(),
  from: dateQuerySchema.optional(),
  to: dateQuerySchema.optional(),
});

export const expenseIdParamSchema = z.object({ id: objectIdSchema });

export type CreateExpenseInput = z.output<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.output<typeof updateExpenseSchema>;
export type ListExpensesQuery = z.output<typeof listExpensesQuerySchema>;
