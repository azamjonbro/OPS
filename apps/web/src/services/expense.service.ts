import type { Expense, ExpenseCategory, ExpenseStatus, PaginatedResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

export interface ListExpensesParams {
  page?: number;
  pageSize?: number;
  branchId?: string;
  category?: ExpenseCategory;
  status?: ExpenseStatus;
  from?: string;
  to?: string;
}

export interface ExpensePayload {
  branchId?: string | null;
  category: ExpenseCategory;
  /** Minor units. */
  amount: number;
  description?: string | null;
  date?: string;
}

export const expenseService = {
  list: (params: ListExpensesParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Expense>>('/v1/expenses', { ...options, params }),

  get: (id: string) => api.get<Expense>(`/v1/expenses/${id}`),

  create: (payload: ExpensePayload) => api.post<Expense>('/v1/expenses', payload),

  update: (id: string, payload: Partial<Omit<ExpensePayload, 'branchId'>>) =>
    api.patch<Expense>(`/v1/expenses/${id}`, payload),

  /** Approving or rejecting; `pending` is the starting state and not a decision. */
  review: (id: string, status: Exclude<ExpenseStatus, 'pending'>) =>
    api.post<Expense>(`/v1/expenses/${id}/review`, { status }),

  remove: (id: string) => api.delete<Expense>(`/v1/expenses/${id}`),
};
