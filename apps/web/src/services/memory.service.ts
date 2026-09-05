import type { Memory, MemoryStatus, MemoryType, PaginatedResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * What the assistant remembers about the person using it.
 *
 * The chat response surfaces `pendingMemories` — things the assistant would
 * like to keep but is not confident enough to keep silently. Confirming or
 * forgetting one goes through these endpoints rather than through the chat, so
 * the decision is recorded as the person's own rather than as something the
 * model talked itself into.
 */
export interface ListMemoriesParams {
  page?: number;
  pageSize?: number;
  type?: MemoryType;
  status?: MemoryStatus;
  search?: string;
}

export const memoryService = {
  list: (
    params: ListMemoriesParams = {},
    options: RequestOptions = {},
  ): Promise<PaginatedResult<Memory>> =>
    api.get<PaginatedResult<Memory>>('/v1/memory', { ...options, params }),

  confirm: (id: string): Promise<Memory> => api.post<Memory>(`/v1/memory/${id}/confirm`),

  forget: (id: string): Promise<{ forgotten: number }> =>
    api.delete<{ forgotten: number }>(`/v1/memory/${id}`),
};
