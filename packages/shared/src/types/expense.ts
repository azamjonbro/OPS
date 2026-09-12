import type { ExpenseCategory, ExpensePaymentMethod } from '../constants/expenses.js';
import type { Entity, MinorUnits } from './entity.js';

/**
 * One cost the shop bore.
 *
 * `date` is a calendar day rather than an instant, on purpose: a rent payment
 * belongs to the day it was made, not to the second, and a day string in the
 * shop's own zone is what analytics buckets by. It is the same form the sales
 * figures use, so an expense and the day's takings land in the same bucket
 * without a timezone in between.
 *
 * Deletion is soft. A cost that was recorded and then removed is still a fact
 * worth being able to see, and the monthly total that once included it should
 * be explicable after the fact.
 */
export interface Expense extends Entity {
  /** Branch the cost belongs to, or `null` for the business as a whole. */
  branch: string | null;
  category: ExpenseCategory;
  /** Minor units (tiyin). Always positive; a refund is a deletion, not a negative. */
  amount: MinorUnits;
  currency: string;
  /** `YYYY-MM-DD`, the local day the cost was incurred. */
  date: string;
  paymentMethod: ExpensePaymentMethod;
  /** Who was paid, when it is worth knowing: "Elektr tarmoqlari", "Ali aka". */
  vendor: string | null;
  note: string | null;
  /** Employee who recorded it. */
  createdBy: string;
  /** Conversation it was recorded from, when the assistant did it. */
  conversation: string | null;
  /** ISO-8601, set when it was removed. Removed rows never appear in totals. */
  deletedAt: string | null;
}

/** One category's share of a period's spending. */
export interface ExpenseCategoryTotal {
  category: ExpenseCategory;
  total: MinorUnits;
  count: number;
  /** Share of the period's total, 0–100, or `null` when nothing was spent. */
  share: number | null;
}

/** One day's spending, for a series beside the day's takings. */
export interface ExpenseDailyPoint {
  /** `YYYY-MM-DD`. */
  date: string;
  total: MinorUnits;
  count: number;
}

/**
 * What a period cost, and where the money went.
 *
 * The window is described the same way analytics describes one, so a figure on
 * the dashboard and a figure the assistant quotes are over the same days.
 */
export interface ExpenseSummary {
  period: {
    from: string;
    to: string;
    label: string;
  };
  currency: string;
  total: MinorUnits;
  count: number;
  byCategory: ExpenseCategoryTotal[];
  daily: ExpenseDailyPoint[];
}
