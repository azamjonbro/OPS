import type { AiUsageReport } from '@hadiya/shared';

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
