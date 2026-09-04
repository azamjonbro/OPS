import type {
  PaginatedResult,
  Payment,
  PaymentMethod,
  Sale,
  SalePaymentStatus,
  SaleStatus,
} from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * Sales and payments.
 *
 * Note what a sale request does *not* contain: prices. The API reads them from
 * the product, so a tampered client cannot decide what something costs, and the
 * totals the till shows are only ever a preview — the receipt comes back from
 * the server and is what gets displayed.
 */
export interface SaleItemPayload {
  productId: string;
  quantity: number;
  /** Absolute discount on the line, in minor units. */
  discount?: number;
}

export interface SalePaymentPayload {
  amount: number;
  method: PaymentMethod;
  reference?: string | null;
}

export interface CreateSalePayload {
  branchId?: string | null;
  customerId?: string | null;
  items: SaleItemPayload[];
  payments?: SalePaymentPayload[];
  note?: string | null;
}

export interface ListSalesParams {
  page?: number;
  pageSize?: number;
  branchId?: string;
  customerId?: string;
  employeeId?: string;
  status?: SaleStatus;
  paymentStatus?: SalePaymentStatus;
  from?: string;
  to?: string;
}

export const saleService = {
  list: (params: ListSalesParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Sale>>('/v1/sales', { ...options, params }),

  get: (id: string) => api.get<Sale>(`/v1/sales/${id}`),

  create: (payload: CreateSalePayload) => api.post<Sale>('/v1/sales', payload),

  cancel: (id: string, reason: string) => api.post<Sale>(`/v1/sales/${id}/cancel`, { reason }),
};

export interface ListPaymentsParams {
  page?: number;
  pageSize?: number;
  saleId?: string;
  customerId?: string;
  method?: PaymentMethod;
  from?: string;
  to?: string;
}

export const paymentService = {
  list: (params: ListPaymentsParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Payment>>('/v1/payments', { ...options, params }),

  record: (payload: {
    saleId?: string | null;
    customerId?: string | null;
    amount: number;
    method: PaymentMethod;
    reference?: string | null;
  }) => api.post<Payment>('/v1/payments', payload),
};
