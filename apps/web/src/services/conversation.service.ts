import type { Conversation, ConversationStatus, Message, PaginatedResult } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * The conversation endpoints, exactly as the API defines them.
 *
 * Everything here is already scoped to the signed-in employee by the API, so
 * the client never sends a user id and cannot ask for another person's threads.
 * A conversation id typed into the URL is not a permission: the server answers
 * "not found" for a thread that is not yours, and this module does nothing to
 * soften that.
 *
 * Every read takes a `signal`, because the two that matter — the sidebar list
 * and a transcript page — are both routinely abandoned mid-flight when somebody
 * types in the search box or opens a different thread.
 */
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

export const conversationService = {
  list: (
    params: ListConversationsParams = {},
    options: RequestOptions = {},
  ): Promise<PaginatedResult<Conversation>> =>
    api.get<PaginatedResult<Conversation>>('/v1/conversations', { ...options, params }),

  get: (id: string, options: RequestOptions = {}): Promise<Conversation> =>
    api.get<Conversation>(`/v1/conversations/${id}`, options),

  create: (title?: string): Promise<Conversation> =>
    api.post<Conversation>('/v1/conversations', title ? { title } : {}),

  messages: (
    id: string,
    params: ListMessagesParams = {},
    options: RequestOptions = {},
  ): Promise<PaginatedResult<Message>> =>
    api.get<PaginatedResult<Message>>(`/v1/conversations/${id}/messages`, { ...options, params }),

  rename: (id: string, title: string): Promise<Conversation> =>
    api.patch<Conversation>(`/v1/conversations/${id}`, { title }),

  setStatus: (id: string, status: ConversationStatus): Promise<Conversation> =>
    api.patch<Conversation>(`/v1/conversations/${id}`, { status }),

  remove: (id: string): Promise<void> => api.delete<void>(`/v1/conversations/${id}`),
};
