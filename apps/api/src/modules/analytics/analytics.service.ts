import {
  ANALYTICS_MAX_RECEIPTS,
  ANALYTICS_THRESHOLDS,
  DEFAULT_CURRENCY,
  formatIsoDateInTimeZone,
  type AnalyticsContributor,
  type AnalyticsInsight,
  type AnalyticsInsightReport,
  type AnalyticsPeriod,
  type AnalyticsRanking,
  type AnalyticsSummary,
  type AuthenticatedUser,
  type MetricComparison,
} from '@hadiya/shared';

import { createLogger } from '../../core/logger/logger.js';
import { createBillzCapabilityRunner, type BillzCapabilityRunner } from '../billz/index.js';
import type { BillzSale } from '../billz/billz.types.js';
import { analyticsCacheKey, readAnalyticsCache, writeAnalyticsCache } from './analytics.cache.js';
import type { NormalisedReceipt, ReceiptWindow } from './analytics.types.js';
import {
  buildRecommendations,
  insightFromAnomaly,
  insightFromComparison,
  insightFromContributors,
  insightFromDataQuality,
  insightFromTrend,
  prioritiseInsights,
} from './insight-generator.js';
import {
  buildDailySeries,
  calculateMetrics,
  compareMetric,
  findTopContributors,
  rankBranches,
  rankProducts,
} from './metric-calculator.js';
import { daysInPeriod, previousPeriod } from './period.js';
import { detectAnomalies, detectTrend } from './trend-analyzer.js';

const log = createLogger('analytics');

/**
 * Where the numbers come from.
 *
 * This is the only file in the module that talks to anything outside it, and it
 * talks to exactly one thing: the Billz capability runner the assistant already
 * uses. No HTTP client, no endpoint, no credential — analytics has no more
 * access to Billz than a chat tool does, which is what keeps the read-only
 * guarantee a property of the architecture rather than a promise.
 *
 * Everything downstream of `fetchWindow` is pure arithmetic over normalised
 * receipts, which is why the calculators can be tested without a network.
 */

export interface AnalyticsDependencies {
  runner?: BillzCapabilityRunner;
  now?: Date;
}

const resolveRunner = (dependencies: AnalyticsDependencies): BillzCapabilityRunner =>
  dependencies.runner ?? createBillzCapabilityRunner();

/**
 * Billz's receipt into the shape the calculators want.
 *
 * The day is decided here, once, in the actor's zone. Every bucket, baseline
 * and series downstream reads `localDate` rather than re-deriving it, so there
 * is exactly one place a timezone bug could live.
 *
 * A receipt with no timestamp is dated to the start of the window rather than
 * dropped: Billz returned it for this period, so its money belongs in the
 * period's total even if its day is unknown. Losing it would understate the
 * total, which is the worse of the two errors.
 */
const normaliseReceipt = (
  sale: BillzSale,
  timezone: string,
  fallbackDate: string,
): NormalisedReceipt => {
  const soldAt = sale.soldAt ? new Date(sale.soldAt) : null;
  const localDate =
    soldAt && !Number.isNaN(soldAt.getTime())
      ? formatIsoDateInTimeZone(soldAt, timezone)
      : fallbackDate;

  return {
    externalId: sale.externalId,
    isReturn: sale.type === 'return',
    total: sale.total,
    debtAmount: sale.debtAmount ?? 0,
    shopExternalId: sale.shopExternalId,
    shopName: sale.shopName,
    customerExternalId: sale.customerExternalId,
    localDate,
    lines: sale.items.map((item) => ({
      productExternalId: item.productExternalId,
      name: item.name,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    })),
  };
};

/**
 * Reads one window of receipts, bounded, and says what it could not see.
 *
 * The bound is the important part. A year of a busy shop is more receipts than
 * belongs in one process's memory, so the fetch stops at a ceiling — and when
 * it does, the answer is marked incomplete rather than being quietly returned
 * as though it were the whole period. An analysis that silently saw half a
 * month is far more dangerous than one that refuses to pretend.
 */
export const fetchWindow = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  dependencies: AnalyticsDependencies = {},
): Promise<ReceiptWindow> => {
  const runner = resolveRunner(dependencies);
  const cacheKey = analyticsCacheKey(actor.id, 'window', {
    from: period.from,
    to: period.to,
    timezone: period.timezone,
  });
  const cached = readAnalyticsCache<ReceiptWindow>(cacheKey);

  if (cached) {
    return cached;
  }

  const { items, total } = await runner.getSales({
    from: period.from,
    to: period.to,
    limit: ANALYTICS_MAX_RECEIPTS,
  });

  const receipts = items.map((sale) => normaliseReceipt(sale, period.timezone, period.from));
  const notes: string[] = [];
  // `total` is what Billz says the period holds; `items` is what the bound let
  // through. A gap between them is the definition of truncation.
  const truncated = items.length >= ANALYTICS_MAX_RECEIPTS && total > items.length;

  if (truncated) {
    notes.push(
      `Only the first ${items.length} of ${total} receipts were analysed, so these figures are partial.`,
    );
  }

  const undated = items.filter((sale) => !sale.soldAt).length;

  if (undated > 0) {
    notes.push(
      `${undated} receipt(s) carry no timestamp; they are counted in the period total but cannot be placed on a day.`,
    );
  }

  const window: ReceiptWindow = {
    receipts,
    quality: {
      complete: notes.length === 0,
      notes,
      recordsAnalysed: receipts.length,
      truncated,
    },
  };

  writeAnalyticsCache(cacheKey, window);

  return window;
};

/** The metric comparisons a summary reports, in the order they matter. */
const COMPARED_METRICS = [
  { metric: 'netSales', label: 'Net sales', money: true },
  { metric: 'grossSales', label: 'Gross sales', money: true },
  { metric: 'saleCount', label: 'Sales', money: false },
  { metric: 'averageOrderValue', label: 'Average order value', money: true },
  { metric: 'unitsSold', label: 'Units sold', money: false },
] as const;

const mergeQuality = (
  first: ReceiptWindow['quality'],
  second: ReceiptWindow['quality'],
): ReceiptWindow['quality'] => ({
  complete: first.complete && second.complete,
  notes: [...first.notes, ...second.notes],
  recordsAnalysed: first.recordsAnalysed + second.recordsAnalysed,
  truncated: first.truncated || second.truncated,
});

/**
 * The headline answer, optionally measured against the period before it.
 *
 * The comparison window is derived from the period's *length*, not from the
 * calendar unit — see `previousPeriod` for why comparing eight days of a month
 * against a whole month is the fastest way to make this feature lie.
 */
export const getSummary = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  options: { compare?: boolean; comparisonPeriod?: AnalyticsPeriod } = {},
  dependencies: AnalyticsDependencies = {},
): Promise<AnalyticsSummary> => {
  const window = await fetchWindow(actor, period, dependencies);
  const metrics = calculateMetrics(window.receipts);
  const daily = buildDailySeries(window.receipts, daysInPeriod(period));

  if (!options.compare && !options.comparisonPeriod) {
    return {
      period,
      metrics,
      comparison: null,
      daily,
      dataQuality: window.quality,
      currency: DEFAULT_CURRENCY,
    };
  }

  const comparisonPeriod = options.comparisonPeriod ?? previousPeriod(period);
  const comparisonWindow = await fetchWindow(actor, comparisonPeriod, dependencies);
  const comparisonMetrics = calculateMetrics(comparisonWindow.receipts);

  const changes: MetricComparison[] = COMPARED_METRICS.map((entry) =>
    compareMetric({
      metric: entry.metric,
      label: entry.label,
      current: metrics[entry.metric],
      previous: comparisonMetrics[entry.metric],
      money: entry.money,
    }),
  );

  return {
    period,
    metrics,
    comparison: { period: comparisonPeriod, metrics: comparisonMetrics, changes },
    daily,
    dataQuality: mergeQuality(window.quality, comparisonWindow.quality),
    currency: DEFAULT_CURRENCY,
  };
};

export interface ComparisonReport {
  current: { period: AnalyticsPeriod; metrics: ReturnType<typeof calculateMetrics> };
  previous: { period: AnalyticsPeriod; metrics: ReturnType<typeof calculateMetrics> };
  changes: MetricComparison[];
  topContributors: AnalyticsContributor[];
  dataQuality: ReceiptWindow['quality'];
}

/**
 * Two windows, the difference between them, and what accounts for it.
 *
 * The contributors are the reason this is a tool of its own rather than two
 * summaries: "revenue fell 100m" is a fact, and "45m of that was one product"
 * is the first thing anybody can actually act on.
 */
export const comparePeriods = async (
  actor: AuthenticatedUser,
  current: AnalyticsPeriod,
  previous: AnalyticsPeriod,
  dependencies: AnalyticsDependencies = {},
): Promise<ComparisonReport> => {
  const [currentWindow, previousWindow] = await Promise.all([
    fetchWindow(actor, current, dependencies),
    fetchWindow(actor, previous, dependencies),
  ]);

  const currentMetrics = calculateMetrics(currentWindow.receipts);
  const previousMetrics = calculateMetrics(previousWindow.receipts);

  const changes = COMPARED_METRICS.map((entry) =>
    compareMetric({
      metric: entry.metric,
      label: entry.label,
      current: currentMetrics[entry.metric],
      previous: previousMetrics[entry.metric],
      money: entry.money,
    }),
  );

  const topContributors = findTopContributors({
    current: rankProducts(currentWindow.receipts),
    previous: rankProducts(previousWindow.receipts),
    dimension: 'product',
    minSharePercent: ANALYTICS_THRESHOLDS.contributorSharePercent,
  });

  return {
    current: { period: current, metrics: currentMetrics },
    previous: { period: previous, metrics: previousMetrics },
    changes,
    topContributors,
    dataQuality: mergeQuality(currentWindow.quality, previousWindow.quality),
  };
};

export const getTopProducts = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  limit: number,
  dependencies: AnalyticsDependencies = {},
): Promise<{ items: AnalyticsRanking[]; dataQuality: ReceiptWindow['quality'] }> => {
  const window = await fetchWindow(actor, period, dependencies);

  return { items: rankProducts(window.receipts, limit), dataQuality: window.quality };
};

export const getBranchPerformance = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  dependencies: AnalyticsDependencies = {},
): Promise<{ items: AnalyticsRanking[]; dataQuality: ReceiptWindow['quality'] }> => {
  const window = await fetchWindow(actor, period, dependencies);

  return { items: rankBranches(window.receipts), dataQuality: window.quality };
};

export const getAnomalies = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  dependencies: AnalyticsDependencies = {},
) => {
  const window = await fetchWindow(actor, period, dependencies);
  const daily = buildDailySeries(window.receipts, daysInPeriod(period));

  return {
    period,
    anomalies: detectAnomalies('revenue', daily),
    daily,
    dataQuality: window.quality,
  };
};

/**
 * The executive summary: everything that changed, ranked by what matters.
 *
 * Deliberately one call rather than four. A model asked "bu oy nimalar
 * o'zgardi?" would otherwise fetch the same window for a trend, an anomaly
 * check, a comparison and a contributor list — four identical Billz reads
 * whose results it then has to reconcile. Here the window is read once and
 * every finding is derived from the same numbers, which also means they cannot
 * disagree with each other.
 */
export const getInsights = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  dependencies: AnalyticsDependencies = {},
): Promise<AnalyticsInsightReport> => {
  const comparison = previousPeriod(period);
  const [currentWindow, previousWindow] = await Promise.all([
    fetchWindow(actor, period, dependencies),
    fetchWindow(actor, comparison, dependencies),
  ]);

  const daily = buildDailySeries(currentWindow.receipts, daysInPeriod(period));
  const currentMetrics = calculateMetrics(currentWindow.receipts);
  const previousMetrics = calculateMetrics(previousWindow.receipts);

  const trend = detectTrend('revenue', daily);
  const anomalies = detectAnomalies('revenue', daily);
  const topContributors = findTopContributors({
    current: rankProducts(currentWindow.receipts),
    previous: rankProducts(previousWindow.receipts),
    dimension: 'product',
    minSharePercent: ANALYTICS_THRESHOLDS.contributorSharePercent,
  });

  const quality = mergeQuality(currentWindow.quality, previousWindow.quality);

  const netSales = compareMetric({
    metric: 'netSales',
    label: 'Net sales',
    current: currentMetrics.netSales,
    previous: previousMetrics.netSales,
    money: true,
  });

  const insights = prioritiseInsights(
    [
      insightFromComparison(netSales, period),
      insightFromTrend(trend, period),
      ...anomalies.map((anomaly) => insightFromAnomaly(anomaly, period)),
      insightFromContributors(topContributors, period),
      insightFromDataQuality(quality, period),
    ].filter((insight): insight is AnalyticsInsight => insight !== null),
  );

  log.debug(
    {
      userId: actor.id,
      period: period.label,
      receipts: quality.recordsAnalysed,
      insights: insights.length,
      complete: quality.complete,
    },
    'insight report built',
  );

  return {
    period,
    insights,
    recommendations: buildRecommendations(insights),
    trends: [trend],
    anomalies,
    topContributors,
    dataQuality: quality,
  };
};

export interface InventoryAnalysisRow {
  productName: string;
  sku: string;
  shopName: string;
  quantity: number;
  stockValue: number;
  /** Units of this product sold in the period, across all branches. */
  unitsSold: number;
}

export interface InventoryAnalysis {
  period: AnalyticsPeriod;
  lowStock: InventoryAnalysisRow[];
  /** In stock, but nothing sold in the period. */
  slowMoving: InventoryAnalysisRow[];
  totalUnits: number;
  totalValue: number;
  dataQuality: ReceiptWindow['quality'];
}

/**
 * What is running out, and what is not moving.
 *
 * The two questions need the same two reads — stock now, sales over a period —
 * so they are answered together rather than as two tools that would each pay
 * for both.
 *
 * "Slow-moving" is defined narrowly and honestly: in stock, and *zero* units
 * sold in the window. A softer definition would need a per-product velocity
 * baseline that this data cannot support without far more history than one
 * period, and a threshold invented here would look like analysis while being
 * arithmetic nobody chose.
 */
export const getInventoryAnalysis = async (
  actor: AuthenticatedUser,
  period: AnalyticsPeriod,
  options: { lowStockThreshold: number; limit: number },
  dependencies: AnalyticsDependencies = {},
): Promise<InventoryAnalysis> => {
  const runner = resolveRunner(dependencies);
  const [window, levels] = await Promise.all([
    fetchWindow(actor, period, dependencies),
    runner.getInventory({}),
  ]);

  const soldUnits = new Map<string, number>();

  for (const receipt of window.receipts) {
    for (const line of receipt.lines) {
      const key = line.productExternalId ?? `name:${line.name}`;
      const sign = receipt.isReturn ? -1 : 1;

      soldUnits.set(key, (soldUnits.get(key) ?? 0) + sign * line.quantity);
    }
  }

  const rows = levels.map<InventoryAnalysisRow>((level) => ({
    productName: level.productName,
    sku: level.sku,
    shopName: level.shopName,
    quantity: level.quantity,
    stockValue: level.stockValue,
    unitsSold: soldUnits.get(level.productExternalId) ?? 0,
  }));

  return {
    period,
    lowStock: rows
      .filter((row) => row.quantity <= options.lowStockThreshold)
      .slice(0, options.limit),
    slowMoving: rows
      .filter((row) => row.quantity > 0 && row.unitsSold <= 0)
      // Most capital tied up first: that is what makes a slow mover worth
      // knowing about rather than merely true.
      .sort((left, right) => right.stockValue - left.stockValue)
      .slice(0, options.limit),
    totalUnits: rows.reduce((sum, row) => sum + row.quantity, 0),
    totalValue: rows.reduce((sum, row) => sum + row.stockValue, 0),
    dataQuality: window.quality,
  };
};
