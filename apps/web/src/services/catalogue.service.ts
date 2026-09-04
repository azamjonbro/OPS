import type {
  Category,
  PaginatedResult,
  Product,
  ProductUnit,
} from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * Products and categories.
 *
 * Money crosses this boundary in minor units, exactly as the API stores it:
 * the conversion to and from a decimal happens in the form, once, so no service
 * or store ever holds a price that has been through a float.
 */
export interface ListProductsParams {
  page?: number;
  pageSize?: number;
  categoryId?: string;
  isActive?: boolean;
  search?: string;
  sku?: string;
  barcode?: string;
}

export interface CreateProductPayload {
  name: string;
  sku: string;
  barcode?: string | null;
  description?: string | null;
  categoryId: string;
  /** Minor units. */
  price: number;
  costPrice?: number;
  unit?: ProductUnit;
  trackInventory?: boolean;
  reorderLevel?: number;
}

export type UpdateProductPayload = Partial<Omit<CreateProductPayload, 'sku'>> & {
  isActive?: boolean;
};

export const productService = {
  list: (params: ListProductsParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Product>>('/v1/products', { ...options, params }),

  get: (id: string) => api.get<Product>(`/v1/products/${id}`),

  create: (payload: CreateProductPayload) => api.post<Product>('/v1/products', payload),

  update: (id: string, payload: UpdateProductPayload) =>
    api.patch<Product>(`/v1/products/${id}`, payload),

  /** Deactivates rather than deletes; the API keeps the record for history. */
  deactivate: (id: string) => api.delete<Product>(`/v1/products/${id}`),
};

export interface ListCategoriesParams {
  page?: number;
  pageSize?: number;
  parentId?: string;
  isActive?: boolean;
  search?: string;
}

export interface CategoryPayload {
  name: string;
  description?: string | null;
  parentId?: string | null;
}

export const categoryService = {
  list: (params: ListCategoriesParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Category>>('/v1/categories', { ...options, params }),

  get: (id: string) => api.get<Category>(`/v1/categories/${id}`),

  create: (payload: CategoryPayload) => api.post<Category>('/v1/categories', payload),

  update: (id: string, payload: Partial<CategoryPayload> & { isActive?: boolean }) =>
    api.patch<Category>(`/v1/categories/${id}`, payload),

  remove: (id: string) => api.delete<Category>(`/v1/categories/${id}`),
};
