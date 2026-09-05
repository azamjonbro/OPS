import type { ChatRequest, ChatResponse } from '@hadiya/shared';

import { api, type RequestOptions } from './http';

/**
 * The assistant's endpoint. There is one, and this is it.
 *
 * Everything Hadiya can do — reading the shop's figures, searching Notion,
 * writing a content plan, drawing an image, setting a reminder — happens
 * because the *backend* chose a tool for the sentence it was given. So the
 * client sends text and a conversation id and nothing else: no tool name, no
 * intent, no routing. That is what keeps the assistant one thing rather than a
 * menu of features wearing a chat interface, and it is why there is no second
 * endpoint here to be tempted by.
 */
export interface AssistantTool {
  name: string;
  description: string;
  mutates: boolean;
  requiresConfirmation: boolean;
  /**
   * How much damage it could do, and whether it may run beside another.
   *
   * Optional because this type is a client's reading of the endpoint rather
   * than a mirror of it: a build of the web app that predates the agent's
   * classification still works, and a component that does not care about risk
   * does not have to narrow it.
   */
  risk?: ToolRisk;
  category?: ToolCategory;
  parallelSafe?: boolean;
}

export interface AssistantStatus {
  provider: string;
  available: boolean;
  model: string | null;
  /** Why it cannot answer, when it cannot. Never a credential or a stack. */
  reason: string | null;
  tools: AssistantTool[];
  /** The budget one turn is held to. Numbers only; never a credential. */
  limits?: {
    maxToolRounds: number;
    maxModelCalls: number;
    maxParallelTools: number;
    toolTimeoutMs: number;
    maxToolRetries: number;
    confirmationTtlMs: number;
  };
}

/**
 * How long one turn may take.
 *
 * The default 30 seconds is right for a list or a form and far too short here:
 * a turn can involve several model calls, and a content plan or a generated
 * image runs for a minute or more server-side. Timing out at 30s would report
 * a failure for work that is still running and will still be saved — the person
 * would then retry and get two plans. This is a ceiling, not an expectation:
 * it exists so a genuinely stuck request eventually fails rather than hanging.
 */
const CHAT_TIMEOUT_MS = 180_000;

export const chatService = {
  /**
   * Sends one turn.
   *
   * Omitting the id opens a conversation, titled server-side from this first
   * message — which is why the response carries the id back rather than the
   * client inventing one.
   */
  send: (
    message: string,
    conversationId?: string,
    options: RequestOptions = {},
  ): Promise<ChatResponse> =>
    api.post<ChatResponse>(
      '/v1/ai/chat',
      { message, ...(conversationId ? { conversationId } : {}) } satisfies ChatRequest,
      { timeout: CHAT_TIMEOUT_MS, ...options },
    ),

  status: (options: RequestOptions = {}): Promise<AssistantStatus> =>
    api.get<AssistantStatus>('/v1/ai/status', options),
};
