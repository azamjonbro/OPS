import { sendSuccess } from '../../core/http/api-response.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import { requireActor } from '../../core/security/actor.js';
import { summariseExpenses } from '../expenses/expense.service.js';
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
 * The expense ledger is read over the same window and taken off the net sales.
 * That difference is deliberately not called a profit. A gross margin needs the
 * cost of each unit sold, which Billz keeps behind an endpoint the API token
 * is refused; what the ledger holds is whatever somebody wrote down, and the
 * figure is named for exactly that so the screen cannot promise more than the
 * data does.
 */
export const dashboard: ValidatedHandler<{ query: typeof dashboardQuerySchema }> = async (
  req,
  res,
) => {
  const actor = requireActor(req);
  const { period: key, from, to, topLimit, lowStockThreshold } = req.validated.query;

  const period = resolvePeriod({ key, timezone: actor.timezone, from, to });

  const [summary, topProducts, inventory, expenses] = await Promise.all([
    getSummary(actor, period, { compare: true }),
    getTopProducts(actor, period, topLimit),
    getInventoryAnalysis(actor, period, { lowStockThreshold, limit: topLimit }),
    summariseExpenses(actor, period),
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
    expenses,
    netAfterExpenses: summary.metrics.netSales - expenses.total,
    dataQuality: summary.dataQuality,
  });
};
