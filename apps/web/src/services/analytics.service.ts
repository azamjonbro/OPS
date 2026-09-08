import type { AnalyticsDashboard, AnalyticsPeriodKey } from '@hadiya/shared';

import { api } from './http';

export interface DashboardParams {
  period?: AnalyticsPeriodKey;
  from?: string;
  to?: string;
  topLimit?: number;
  lowStockThreshold?: number;
}

/**
 * The dashboard's numbers.
 *
 * One call, because the API assembles the screen from a single window of
 * receipts. The shop scope is the deployment's, not the browser's: what counts
 * as "the shop" is `BILLZ_SHOP_IDS` on the server, so no client can widen it.
 */
export const analyticsService = {
  dashboard: (params: DashboardParams = {}): Promise<AnalyticsDashboard> =>
    api.get<AnalyticsDashboard>('/v1/analytics/dashboard', { params }),
};
