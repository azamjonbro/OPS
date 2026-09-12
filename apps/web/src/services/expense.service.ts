import type {
  AnalyticsPeriodKey,
  Expense,
  ExpenseCategory,
  ExpensePaymentMethod,
  ExpenseSummary,
  PaginatedResult,
} from '@hadiya/shared';

import { api } from './http';

/**
 * The expense ledger's endpoints.
 *
 * Amounts cross the wire in tiyin, as all money in Hadiya does. The form lets
 * a person type so'm, and the multiplication happens in the page before the
 * payload is built — never here, so the service is a faithful copy of the API
 * and nothing more.
 */
export interface CreateExpensePayload {
  category: ExpenseCategory;
  /** Minor units. */
  amount: number;
  /** `YYYY-MM-DD`; today when left out. */
  date?: string;
  paymentMethod?: ExpensePaymentMethod;
  vendor?: string | null;
  note?: string | null;
}

export type UpdateExpensePayload = Partial<CreateExpensePayload>;

export interface ListExpensesParams {
  page?: number;
  pageSize?: number;
  from?: string;
  to?: string;
  category?: ExpenseCategory;
  paymentMethod?: ExpensePaymentMethod;
  search?: string;
}

export interface ExpenseSummaryParams {
  period?: AnalyticsPeriodKey;
  from?: string;
  to?: string;
}

export const expenseService = {
  list: (
    params: ListExpensesParams = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResult<Expense>> =>
    api.get<PaginatedResult<Expense>>('/v1/expenses', { params, signal }),

  summary: (params: ExpenseSummaryParams = {}): Promise<ExpenseSummary> =>
    api.get<ExpenseSummary>('/v1/expenses/summary', { params }),

  create: (payload: CreateExpensePayload): Promise<Expense> =>
    api.post<Expense>('/v1/expenses', payload),

  update: (id: string, payload: UpdateExpensePayload): Promise<Expense> =>
    api.patch<Expense>(`/v1/expenses/${id}`, payload),

  remove: (id: string): Promise<Expense> => api.delete<Expense>(`/v1/expenses/${id}`),
};
