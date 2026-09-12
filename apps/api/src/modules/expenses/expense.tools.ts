import {
  ANALYTICS_PERIODS,
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_MAX_AMOUNT,
  EXPENSE_NOTE_MAX_LENGTH,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_VENDOR_MAX_LENGTH,
  formatMoney,
  fromMinorUnits,
  toMinorUnits,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from '@hadiya/shared';
import { z } from 'zod';

import type { RegisteredTool, ToolContext } from '../ai/tools/tool-registry.js';
import { resolvePeriod } from '../analytics/period.js';
import type { ExpenseDocument } from './expense.model.js';
import {
  createExpense,
  deleteExpense,
  getExpense,
  listExpenses,
  summariseExpenses,
  updateExpense,
} from './expense.service.js';

/**
 * The expense ledger, as the assistant reaches it.
 *
 * "Bugun ijaraga 3 million to'ladim" is a sentence, and a person who has to
 * leave the conversation to type it into a form will not. So recording is a
 * tool — a plain write, no confirmation, because a wrongly recorded cost is
 * cheap to remove and the tool for that asks first.
 *
 * Amounts cross this boundary in whole so'm, not tiyin. The model reads
 * "3 million" and would write `3000000`; the service stores minor units, and
 * the conversion happens here, once, rather than in the model's head where a
 * factor of a hundred goes missing silently.
 */

const money = (minor: number): string => formatMoney(minor);

const categoryList = EXPENSE_CATEGORIES.map(
  (category) => `${category} (${EXPENSE_CATEGORY_LABELS[category]})`,
).join(', ');

const categorySchema = z
  .enum(EXPENSE_CATEGORIES)
  .describe(`One of: ${categoryList}. goods is stock bought for resale.`);

const amountSchema = z
  .number()
  .positive()
  .max(fromMinorUnits(EXPENSE_MAX_AMOUNT))
  .describe("In whole so'm, e.g. 3000000 for three million. Never in tiyin.");

const daySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("YYYY-MM-DD in the user's own zone. Leave out for today.");

const describe = (expense: ExpenseDocument): string =>
  [
    `${expense.date}: ${money(expense.amount)} — ${EXPENSE_CATEGORY_LABELS[expense.category]}`,
    expense.vendor ? `to ${expense.vendor}` : '',
    expense.note ? `(${expense.note})` : '',
    `[${expense.paymentMethod}, id ${String(expense._id)}]`,
  ]
    .filter(Boolean)
    .join(' ');

const summarise = (expense: ExpenseDocument) => ({
  id: String(expense._id),
  category: expense.category,
  amount: expense.amount,
  currency: expense.currency,
  date: expense.date,
  paymentMethod: expense.paymentMethod,
  vendor: expense.vendor,
  note: expense.note,
});

const recordTool: RegisteredTool = {
  name: 'expenses_record',
  category: 'business',
  mutates: true,
  risk: 'write',
  resource: 'expenses',
  description:
    'Record a cost the shop paid: rent, salary, utilities, stock bought for resale, and so on. Use whenever the user says they paid or spent something — "ijaraga 3 million to\'ladim", "bugun 200 ming benzinga ketdi". The amount is in whole so\'m. Defaults to today and to cash; ask only if the category is genuinely unclear, otherwise pick the closest one.',
  schema: z.object({
    category: categorySchema,
    amount: amountSchema,
    date: daySchema.optional(),
    paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).default('cash'),
    vendor: z
      .string()
      .trim()
      .max(EXPENSE_VENDOR_MAX_LENGTH)
      .optional()
      .describe('Who was paid, if the user named them'),
    note: z.string().trim().max(EXPENSE_NOTE_MAX_LENGTH).optional(),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as {
      category: ExpenseCategory;
      amount: number;
      date?: string;
      paymentMethod: ExpensePaymentMethod;
      vendor?: string;
      note?: string;
    };

    const expense = await createExpense(context.actor, {
      category: args.category,
      amount: toMinorUnits(args.amount),
      date: args.date,
      paymentMethod: args.paymentMethod,
      vendor: args.vendor,
      note: args.note,
      conversationId: context.conversationId,
    });

    return { summary: `Recorded ${describe(expense)}.`, data: summarise(expense) };
  },
};

const listTool: RegisteredTool = {
  name: 'expenses_list',
  category: 'business',
  mutates: false,
  risk: 'read',
  parallelSafe: true,
  description:
    'The individual expenses recorded over a range of days, newest first, optionally one category. Use for "bu hafta nimalarga pul ketdi?" or to find the id of an entry the user wants changed or removed. For totals use expenses_get_summary instead.',
  schema: z.object({
    from: daySchema.optional(),
    to: daySchema.optional(),
    category: categorySchema.optional(),
    search: z.string().trim().min(1).max(80).optional().describe('Matches vendor or note'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as {
      from?: string;
      to?: string;
      category?: ExpenseCategory;
      search?: string;
      limit: number;
    };

    const result = await listExpenses(context.actor, {
      page: 1,
      pageSize: args.limit,
      from: args.from,
      to: args.to,
      category: args.category,
      search: args.search,
    });

    if (result.items.length === 0) {
      return { summary: 'No expenses recorded for that.', data: { items: [], total: 0 } };
    }

    const shown = result.items.map(describe).join('; ');
    const more =
      result.pagination.total > result.items.length
        ? ` (${result.pagination.total - result.items.length} more not shown)`
        : '';

    return {
      summary: `${result.pagination.total} expense(s)${more}: ${shown}.`,
      data: { items: result.items.map(summarise), total: result.pagination.total },
    };
  },
};

const summaryTool: RegisteredTool = {
  name: 'expenses_get_summary',
  category: 'business',
  mutates: false,
  risk: 'read',
  parallelSafe: true,
  description:
    'What the shop spent over a period, in total and by category. Answers "bu oy qancha xarajat bo\'ldi?" and "eng katta xarajat nima?". Pair it with analytics_get_summary over the same period to say what was left after costs — and say plainly that the result is takings minus recorded expenses, not a gross margin, because the cost of each unit sold is not known.',
  schema: z.object({
    period: z.enum(ANALYTICS_PERIODS).default('this_month'),
    from: daySchema.optional().describe('Required when period is custom'),
    to: daySchema.optional().describe('Required when period is custom'),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as { period: (typeof ANALYTICS_PERIODS)[number]; from?: string; to?: string };
    const period = resolvePeriod({
      key: args.period,
      timezone: context.actor.timezone,
      from: args.from,
      to: args.to,
    });
    const result = await summariseExpenses(context.actor, period);

    if (result.count === 0) {
      return {
        summary: `Nothing recorded for ${period.label} (${period.from} → ${period.to}). If money was spent, it has not been written down.`,
        data: result,
      };
    }

    const breakdown = result.byCategory
      .filter((row) => row.count > 0)
      .map(
        (row) =>
          `${EXPENSE_CATEGORY_LABELS[row.category]} ${money(row.total)} (${row.share}%, ${row.count} entr${row.count === 1 ? 'y' : 'ies'})`,
      )
      .join('; ');

    return {
      summary: `${period.label} (${period.from} → ${period.to}): ${money(result.total)} across ${result.count} expense(s). ${breakdown}.`,
      data: result,
    };
  },
};

const updateTool: RegisteredTool = {
  name: 'expenses_update',
  category: 'business',
  mutates: true,
  risk: 'write',
  resource: 'expenses',
  description:
    "Correct a recorded expense — its amount, category, date, vendor or note. Find the id with expenses_list first. Give only the fields that change; the amount is in whole so'm.",
  schema: z.object({
    expenseId: z.string().trim().length(24).describe('From expenses_list'),
    category: categorySchema.optional(),
    amount: amountSchema.optional(),
    date: daySchema.optional(),
    paymentMethod: z.enum(EXPENSE_PAYMENT_METHODS).optional(),
    vendor: z.string().trim().max(EXPENSE_VENDOR_MAX_LENGTH).nullable().optional(),
    note: z.string().trim().max(EXPENSE_NOTE_MAX_LENGTH).nullable().optional(),
  }),
  execute: async (raw, context: ToolContext) => {
    const { expenseId, amount, ...rest } = raw as {
      expenseId: string;
      category?: ExpenseCategory;
      amount?: number;
      date?: string;
      paymentMethod?: ExpensePaymentMethod;
      vendor?: string | null;
      note?: string | null;
    };

    const expense = await updateExpense(context.actor, expenseId, {
      ...rest,
      ...(amount === undefined ? {} : { amount: toMinorUnits(amount) }),
    });

    return { summary: `Updated: ${describe(expense)}.`, data: summarise(expense) };
  },
};

const deleteTool: RegisteredTool = {
  name: 'expenses_delete',
  category: 'business',
  mutates: true,
  // Enforced by the registry, so the guard cannot be skipped inside the tool.
  requiresConfirmation: true,
  resource: 'expenses',
  description:
    'Remove a recorded expense from every list and total. The user has to agree first: call it once to see what would go, tell them, and call again with confirm: true only after they say yes.',
  schema: z.object({
    expenseId: z.string().trim().length(24).describe('From expenses_list'),
    confirm: z
      .boolean()
      .default(false)
      .describe('True only after the user has explicitly agreed to the removal'),
  }),
  describeConfirmation: async (args, context) => {
    const { expenseId } = args as { expenseId: string };
    // Read before describing, so the person is told what would actually go.
    const expense = await getExpense(context.actor, expenseId);

    return `remove the expense ${describe(expense)}`;
  },
  execute: async (raw, context: ToolContext) => {
    const { expenseId } = raw as { expenseId: string };
    const expense = await deleteExpense(context.actor, expenseId);

    return {
      summary: `Removed ${describe(expense)}.`,
      data: { deleted: true, ...summarise(expense) },
    };
  },
};

export const EXPENSE_TOOLS: readonly RegisteredTool[] = [
  recordTool,
  listTool,
  summaryTool,
  updateTool,
  deleteTool,
];
