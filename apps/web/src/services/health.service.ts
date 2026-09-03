import type { HealthPayload } from '@hadiya/shared';

import { api } from './http';

export const healthService = {
  /** Reads the API's own health endpoint — the same payload probes receive. */
  fetch: (): Promise<HealthPayload> => api.get<HealthPayload>('/health'),
};
