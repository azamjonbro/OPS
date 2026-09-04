import type { Branch, PaginatedResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

export const branchService = {
  list: (params: { page?: number; pageSize?: number } = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Branch>>('/v1/branches', { ...options, params }),

  get: (id: string) => api.get<Branch>(`/v1/branches/${id}`),
};
