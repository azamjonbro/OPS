import type {
  AiUsageReport,
  IntegrationAuditEntry,
  IntegrationDetail,
  IntegrationHealth,
  IntegrationProviderInfo,
  Integration as IntegrationView,
  McpAuthMethod,
  McpToolPermission,
  McpTransport,
  PaginatedResult,
} from '@hadiya/shared';

import { api, type RequestOptions } from './http';
import { chatService, type AssistantStatus } from './chat.service';
import { imageService, type ImageProviderStatus } from './image.service';

/**
 * What Hadiya is connected to, and what it has spent.
 *
 * Each status comes from the endpoint that module already publishes rather than
 * from one aggregate endpoint invented for this screen — so a module's own idea
 * of "healthy" is the one shown, and a new integration appears here by adding a
 * line rather than by changing a server.
 *
 * Every one of these reports the resolved provider and never a credential. That
 * is a property of the endpoints themselves, and it is why this page can exist
 * at all.
 */
export interface BillzConnectionStatus {
  configured: boolean;
  connected: boolean;
  baseUrl: string;
  /** Populated only when the probe failed. */
  error: string | null;
  checkedAt: string;
}

export const integrationService = {
  billz: (options: RequestOptions = {}): Promise<BillzConnectionStatus> =>
    api.get<BillzConnectionStatus>('/v1/integrations/billz/status', options),

  assistant: (options: RequestOptions = {}): Promise<AssistantStatus> =>
    chatService.status(options),

  images: (): Promise<ImageProviderStatus> => imageService.status(),

  /**
   * What the assistant has cost, counted from Hadiya's own records.
   *
   * Not the provider's balance. OpenAI does not let an ordinary project key
   * read one — that needs an admin key with `api.usage.read`, or the billing
   * page in a browser — so this reports what was actually spent through this
   * application instead of guessing at what is left.
   */
  usage: (options: RequestOptions = {}): Promise<AiUsageReport> =>
    api.get<AiUsageReport>('/v1/ai/usage', options),
};

/* -------------------------------------------------------------------------- */
/* The Integration Hub                                                        */
/* -------------------------------------------------------------------------- */

/**
 * What a person types when connecting something.
 *
 * `secret` travels in one direction only. It appears on this payload and on no
 * response type anywhere in the client: once sent it can be replaced but never
 * read back, so there is no state in the browser for it to leak from and no
 * screen that could accidentally render it.
 */
export interface CreateIntegrationPayload {
  provider: 'billz' | 'notion' | 'custom_mcp';
  name: string;
  description?: string | null;
  serverUrl?: string;
  transport?: McpTransport;
  authMethod?: McpAuthMethod;
  authHeaderName?: string | null;
  secret?: string;
}

export type UpdateIntegrationPayload = Partial<Omit<CreateIntegrationPayload, 'provider'>> & {
  enabled?: boolean;
};

/** The answer to connect, test and refresh: the state and how it was reached. */
export interface IntegrationActionResult {
  health: IntegrationHealth;
  integration: IntegrationDetail;
}

const base = '/v1/integrations';

export const integrationHubService = {
  /** What the "add integration" screen may offer; the server decides. */
  catalogue: (options: RequestOptions = {}): Promise<{ items: IntegrationProviderInfo[] }> =>
    api.get(`${base}/catalogue`, options),

  list: (options: RequestOptions = {}): Promise<PaginatedResult<IntegrationView>> =>
    api.get(`${base}?pageSize=50`, options),

  get: (id: string, options: RequestOptions = {}): Promise<IntegrationDetail> =>
    api.get(`${base}/${id}`, options),

  create: (payload: CreateIntegrationPayload): Promise<IntegrationDetail> =>
    api.post(base, payload),

  update: (id: string, payload: UpdateIntegrationPayload): Promise<IntegrationDetail> =>
    api.patch(`${base}/${id}`, payload),

  remove: (id: string): Promise<void> => api.delete(`${base}/${id}`),

  // All POST, because every one reaches a server and records what it found.
  test: (id: string): Promise<IntegrationActionResult> => api.post(`${base}/${id}/test`),
  connect: (id: string): Promise<IntegrationActionResult> => api.post(`${base}/${id}/connect`),
  refresh: (id: string): Promise<IntegrationActionResult> => api.post(`${base}/${id}/refresh`),
  disconnect: (id: string): Promise<IntegrationDetail> => api.post(`${base}/${id}/disconnect`),

  setToolPermission: (
    id: string,
    tool: string,
    permission: McpToolPermission,
  ): Promise<IntegrationDetail> => api.patch(`${base}/${id}/tools/${tool}`, { permission }),

  activity: (
    params: { integrationId?: string; pageSize?: number } = {},
  ): Promise<PaginatedResult<IntegrationAuditEntry>> => {
    const query = new URLSearchParams({ pageSize: String(params.pageSize ?? 20) });

    if (params.integrationId) {
      query.set('integrationId', params.integrationId);
    }

    return api.get(`${base}/activity?${query.toString()}`);
  },
};
