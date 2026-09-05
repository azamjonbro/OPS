import type {
  AlertPreference,
  AlertSeverity,
  AlertStatus,
  AlertSummary,
  AlertType,
  BusinessAlert,
  PaginatedResult,
  QuietHours,
} from '@hadiya/shared';

import { api } from './http';

export interface ListAlertsParams {
  page?: number;
  pageSize?: number;
  status?: AlertStatus;
  severity?: AlertSeverity;
  type?: AlertType;
  activeOnly?: boolean;
}

/**
 * The alert endpoints.
 *
 * Everything is scoped to the signed-in employee by the API, so the client
 * never sends a user id and cannot ask for anybody else's alerts. Nothing here
 * can cause an evaluation either: detection is the scheduler's, and a browser
 * that could trigger one could be made to hammer Billz from a page reload.
 */
export const alertService = {
  list: (params: ListAlertsParams = {}): Promise<PaginatedResult<BusinessAlert>> =>
    api.get<PaginatedResult<BusinessAlert>>('/v1/alerts', { params }),

  summary: (): Promise<AlertSummary> => api.get<AlertSummary>('/v1/alerts/summary'),

  get: (id: string): Promise<BusinessAlert> => api.get<BusinessAlert>(`/v1/alerts/${id}`),

  acknowledge: (id: string): Promise<BusinessAlert> =>
    api.post<BusinessAlert>(`/v1/alerts/${id}/status`, { action: 'acknowledge' }),

  dismiss: (id: string): Promise<BusinessAlert> =>
    api.post<BusinessAlert>(`/v1/alerts/${id}/status`, { action: 'dismiss' }),

  preferences: (): Promise<AlertPreference> => api.get<AlertPreference>('/v1/alerts/preferences'),

  updatePreferences: (input: {
    disabledTypes?: AlertType[];
    minSeverity?: AlertSeverity;
    quietHours?: QuietHours;
  }): Promise<AlertPreference> => api.patch<AlertPreference>('/v1/alerts/preferences', input),
};
