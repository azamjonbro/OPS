import type {
  ChatResponse,
  Conversation,
  ConversationStatus,
  Memory,
  Message,
  PaginatedResult,
} from '@hadiya/shared';

import { api } from './http';

export interface ListConversationsParams {
  page?: number;
  pageSize?: number;
  status?: ConversationStatus;
  search?: string;
}

export interface ListMessagesParams {
  page?: number;
  pageSize?: number;
}

/**
 * The conversation and memory endpoints, in one place.
 *
 * Everything here is already scoped to the signed-in employee by the API, so
 * the client never sends a user id and cannot ask for someone else's threads.
 */
export const conversationService = {
  list: (params: ListConversationsParams = {}): Promise<PaginatedResult<Conversation>> =>
    api.get<PaginatedResult<Conversation>>('/v1/conversations', { params }),

  get: (id: string): Promise<Conversation> => api.get<Conversation>(`/v1/conversations/${id}`),

  create: (title?: string): Promise<Conversation> =>
    api.post<Conversation>('/v1/conversations', title ? { title } : {}),

  messages: (id: string, params: ListMessagesParams = {}): Promise<PaginatedResult<Message>> =>
    api.get<PaginatedResult<Message>>(`/v1/conversations/${id}/messages`, { params }),

  rename: (id: string, title: string): Promise<Conversation> =>
    api.patch<Conversation>(`/v1/conversations/${id}`, { title }),

  setStatus: (id: string, status: ConversationStatus): Promise<Conversation> =>
    api.patch<Conversation>(`/v1/conversations/${id}`, { status }),

  remove: (id: string): Promise<void> => api.delete<void>(`/v1/conversations/${id}`),

  /** Sends a turn to the assistant; omit the id to open a new conversation. */
  chat: (message: string, conversationId?: string): Promise<ChatResponse> =>
    api.post<ChatResponse>('/v1/ai/chat', {
      message,
      ...(conversationId ? { conversationId } : {}),
    }),
};

export const memoryService = {
  list: (): Promise<PaginatedResult<Memory>> => api.get<PaginatedResult<Memory>>('/v1/memory'),
  confirm: (id: string): Promise<Memory> => api.post<Memory>(`/v1/memory/${id}/confirm`),
  forget: (id: string): Promise<{ forgotten: number }> =>
    api.delete<{ forgotten: number }>(`/v1/memory/${id}`),
};
