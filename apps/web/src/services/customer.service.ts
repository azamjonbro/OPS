import type { Customer, CustomerStatus, PaginatedResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

export interface ListCustomersParams {
  page?: number;
  pageSize?: number;
  branchId?: string;
  status?: CustomerStatus;
  /** Matches name or phone. */
  search?: string;
  withDebt?: boolean;
}

export interface CustomerPayload {
  fullName: string;
  phone: string;
  notes?: string | null;
  branchId?: string | null;
}

export const customerService = {
  list: (params: ListCustomersParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Customer>>('/v1/customers', { ...options, params }),

  get: (id: string) => api.get<Customer>(`/v1/customers/${id}`),

  create: (payload: CustomerPayload) => api.post<Customer>('/v1/customers', payload),

  update: (id: string, payload: Partial<CustomerPayload> & { status?: CustomerStatus }) =>
    api.patch<Customer>(`/v1/customers/${id}`, payload),

  remove: (id: string) => api.delete<Customer>(`/v1/customers/${id}`),
};
