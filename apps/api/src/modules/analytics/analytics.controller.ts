import { sendSuccess } from '../../core/http/api-response.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import { requireActor } from '../../core/security/actor.js';
import { getInventoryAnalysis, getSummary, getTopProducts } from './analytics.service.js';
import type { dashboardQuerySchema } from './analytics.validators.js';
import { resolvePeriod } from './period.js';

/**
 * Everything one screen needs, in one request.
 *
 * Three reads rather than three endpoints, and they run together: the summary,
 * the top products and the stock position all draw on the same window of
 * receipts, which the analytics cache holds for the length of the request. Three
 * separate calls from the browser would fetch that window three times and show
 * the tiles arriving one after another, which reads as a slow product even when
 * the numbers are identical.
 *
 * What is *not* here is as deliberate. There is no gross-profit figure, because
 * no cost of goods reaches this deployment — Billz refuses the API token the
 * transaction endpoint it would come from. A screen that showed a margin
 * derived from revenue alone would be inventing one, so the tile stays absent
 * until an expense source exists.
 */
export const dashboard: ValidatedHandler<{ query: typeof dashboardQuerySchema }> = async (
  req,
  res,
) => {
  const actor = requireActor(req);
  const { period: key, from, to, topLimit, lowStockThreshold } = req.validated.query;

  const period = resolvePeriod({ key, timezone: actor.timezone, from, to });

  const [summary, topProducts, inventory] = await Promise.all([
    getSummary(actor, period, { compare: true }),
    getTopProducts(actor, period, topLimit),
    getInventoryAnalysis(actor, period, { lowStockThreshold, limit: topLimit }),
  ]);

  sendSuccess(req, res, {
    period: summary.period,
    currency: summary.currency,
    metrics: summary.metrics,
    comparison: summary.comparison,
    daily: summary.daily,
    topProducts: topProducts.items,
    lowStock: inventory.lowStock,
    slowMoving: inventory.slowMoving,
    stock: { totalUnits: inventory.totalUnits, totalValue: inventory.totalValue },
    dataQuality: summary.dataQuality,
  });
};
