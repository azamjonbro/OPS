import {
  ANALYTICS_PERIODS,
  EXPENSE_CATEGORIES,
  EXPENSE_MAX_AMOUNT,
  EXPENSE_NOTE_MAX_LENGTH,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_VENDOR_MAX_LENGTH,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * A calendar day, not an instant. The service decides whether it is too far in
 * the past or the future, so there is one authority on that rule.
 */
export const expenseDaySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * Money arrives as an integer count of minor units, like everywhere else in
 * Hadiya. A client that lets a person type "120 000" multiplies before sending;
 * the API never guesses whether a number was so'm or tiyin.
 */
export const expenseAmountSchema = z.number().int().min(1).max(EXPENSE_MAX_AMOUNT);

const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const createExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES),
  amount: expenseAmountSchema,
  /** Defaults to today in the actor's zone when left out. */
  date: expenseDaySchema.optional(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).default('cash'),
  vendor: optionalText(EXPENSE_VENDOR_MAX_LENGTH),
  note: optionalText(EXPENSE_NOTE_MAX_LENGTH),
  branchId: objectIdSchema.nullish(),
  conversationId: objectIdSchema.nullish(),
});

export const updateExpenseSchema = z.object({
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  amount: expenseAmountSchema.optional(),
  date: expenseDaySchema.optional(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
  vendor: optionalText(EXPENSE_VENDOR_MAX_LENGTH),
  note: optionalText(EXPENSE_NOTE_MAX_LENGTH),
});

export const listExpensesQuerySchema = paginationQuerySchema.extend({
  from: expenseDaySchema.optional(),
  to: expenseDaySchema.optional(),
  category: z.enum(EXPENSE_CATEGORIES).optional(),
  paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
  branchId: objectIdSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

/**
 * The same period vocabulary the dashboard and the assistant use, so "this
 * month's spending" covers exactly the days "this month's sales" does.
 */
export const expenseSummaryQuerySchema = z
  .object({
    period: z.enum(ANALYTICS_PERIODS).default('this_month'),
    from: expenseDaySchema.optional(),
    to: expenseDaySchema.optional(),
    branchId: objectIdSchema.optional(),
  })
  .refine(
    (value) => value.period !== 'custom' || (value.from !== undefined && value.to !== undefined),
    { message: 'A custom period needs both from and to.', path: ['period'] },
  );

export const expenseIdParamSchema = z.object({ id: objectIdSchema });
