import type {
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  PaginatedResult,
} from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * Stock, read-only from the client's point of view for anything derived.
 *
 * A movement is *recorded*, never a quantity *set*: the API computes the new
 * balance and writes the stock card in one transaction, so the client cannot
 * put on-hand and history out of step with each other.
 */
export interface ListStockParams {
  page?: number;
  pageSize?: number;
  branchId?: string;
  productId?: string;
  /** Stock at or below this level — the reorder view. */
  maxQuantity?: number;
}

export interface ListMovementsParams {
  page?: number;
  pageSize?: number;
  branchId?: string;
  productId?: string;
  type?: InventoryMovementType;
  from?: string;
  to?: string;
}

/** Only these three may be recorded by hand; sales and transfers write the rest. */
export type ManualMovementType = 'purchase' | 'return' | 'adjustment';

export interface RecordMovementPayload {
  productId: string;
  branchId?: string | null;
  type: ManualMovementType;
  /** Signed for an adjustment, a magnitude otherwise. */
  quantity: number;
  note?: string | null;
}

export const inventoryService = {
  stock: (params: ListStockParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<InventoryItem>>('/v1/inventory', { ...options, params }),

  movements: (params: ListMovementsParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<InventoryMovement>>('/v1/inventory/movements', { ...options, params }),

  recordMovement: (payload: RecordMovementPayload) =>
    api.post<InventoryMovement>('/v1/inventory/movements', payload),

  transfer: (payload: {
    productId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: number;
    note?: string | null;
  }) => api.post<{ from: InventoryItem; to: InventoryItem }>('/v1/inventory/transfers', payload),
};
