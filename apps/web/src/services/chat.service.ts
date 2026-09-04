import type {
  ChatResponse,
  Conversation,
  ConversationStatus,
  Memory,
  Message,
  PaginatedResult,
} from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * The assistant's endpoints, exactly as the API defines them.
 *
 * There is one chat endpoint and this is it. Everything the assistant can do —
 * reading Billz, writing content, drawing an image, setting a reminder — happens
 * because the *backend* chose a tool, so the client sends a sentence and a
 * conversation id and nothing more. No capability here is addressed directly,
 * which is what keeps the assistant one thing rather than a menu of features
 * wearing a chat interface.
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

export const chatService = {
  /**
   * Sends a turn. Omit the id and the API opens a conversation, titled from
   * this first message — which is why the response carries the id back.
   */
  send: (message: string, conversationId?: string, options: RequestOptions = {}) =>
    api.post<ChatResponse>(
      '/v1/ai/chat',
      { message, ...(conversationId ? { conversationId } : {}) },
      options,
    ),

  status: (options: RequestOptions = {}) =>
    api.get<AssistantStatus>('/v1/ai/status', options),
};

export interface AssistantStatus {
  provider: string;
  available: boolean;
  model: string | null;
  reason: string | null;
  tools: Array<{
    name: string;
    description: string;
    mutates: boolean;
    requiresConfirmation: boolean;
  }>;
}

export const conversationService = {
  list: (params: ListConversationsParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Conversation>>('/v1/conversations', { ...options, params }),

  get: (id: string, options: RequestOptions = {}) =>
    api.get<Conversation>(`/v1/conversations/${id}`, options),

  create: (title?: string) =>
    api.post<Conversation>('/v1/conversations', title ? { title } : {}),

  messages: (id: string, params: ListMessagesParams = {}, options: RequestOptions = {}) =>
    api.get<PaginatedResult<Message>>(`/v1/conversations/${id}/messages`, { ...options, params }),

  rename: (id: string, title: string) =>
    api.patch<Conversation>(`/v1/conversations/${id}`, { title }),

  setStatus: (id: string, status: ConversationStatus) =>
    api.patch<Conversation>(`/v1/conversations/${id}`, { status }),

  remove: (id: string) => api.delete<void>(`/v1/conversations/${id}`),
};

/**
 * Memory the assistant proposed but has not been allowed to keep.
 *
 * Surfaced by the chat response as `pendingMemories`; confirming or forgetting
 * goes through the memory module's own endpoints rather than through the chat,
 * so the decision is recorded as the person's rather than the model's.
 */
export const memoryService = {
  confirm: (id: string) => api.post<Memory>(`/v1/memory/${id}/confirm`),
  forget: (id: string) => api.delete<{ forgotten: number }>(`/v1/memory/${id}`),
};
