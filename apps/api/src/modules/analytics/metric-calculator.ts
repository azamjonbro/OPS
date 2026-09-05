import {
  ANALYTICS_MAX_RANKING,
  type AnalyticsContributor,
  type AnalyticsDailyPoint,
  type AnalyticsMetricSet,
  type AnalyticsRanking,
  type MetricComparison,
  type TrendDirection,
} from '@hadiya/shared';

import type { NormalisedReceipt } from './analytics.types.js';

/**
 * The arithmetic, with nothing else in it.
 *
 * Every function here is pure and synchronous: given the same receipts it
 * returns the same figures, which is what makes analytics testable without a
 * Billz account and what keeps the model out of the business of adding up. The
 * model interprets these numbers; it never computes them.
 *
 * Money stays in integer minor units. Averages are rounded to a whole minor
 * unit rather than carried as floats, because a total that does not equal the
 * sum of its parts is the kind of error a shopkeeper notices and never trusts
 * again.
 */

/**
 * Percentage change from `previous` to `current`.
 *
 * `null` when there is nothing to grow from. This is the one piece of analytics
 * arithmetic with a genuinely contested answer, so it is worth being explicit:
 *
 *  - 1 080 → 1 206 is `+11.666…`, returned unrounded so the caller decides the
 *    precision. Rounding here would make totals disagree with their own parts.
 *  - 100 → 0 is `-100`: everything that was there is gone, which is a real and
 *    fully-defined percentage.
 *  - 0 → 100 is `null`, *not* `Infinity` and not `+100`. Something appearing
 *    where there was nothing is a real event, but it has no percentage; both
 *    alternatives would be a confident-looking falsehood.
 *  - 0 → 0 is `null` for the same reason, and `flat` by direction.
 *
 * A negative base (a period that netted a refund) is also refused: the sign of
 * the resulting percentage is meaningless, and a "-250% improvement" helps
 * nobody.
 */
export const percentageChange = (current: number, previous: number): number | null => {
  if (previous === 0 || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return null;
  }

  if (previous < 0) {
    return null;
  }

  return ((current - previous) / previous) * 100;
};

/**
 * Which way a figure moved.
 *
 * Decided from the absolute change rather than from the percentage, so a move
 * away from zero — where there is no percentage at all — still has a direction.
 */
export const directionOf = (absoluteChange: number): TrendDirection => {
  if (absoluteChange > 0) {
    return 'up';
  }

  return absoluteChange < 0 ? 'down' : 'flat';
};

/** Percentages are reported to two decimals; the raw value stays available. */
export const roundPercent = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 100) / 100;

export const compareMetric = (options: {
  metric: string;
  label: string;
  current: number;
  previous: number;
  money: boolean;
}): MetricComparison => {
  const absoluteChange = options.current - options.previous;

  return {
    metric: options.metric,
    label: options.label,
    current: options.current,
    previous: options.previous,
    absoluteChange,
    percentageChange: roundPercent(percentageChange(options.current, options.previous)),
    direction: directionOf(absoluteChange),
    money: options.money,
  };
};

/**
 * The headline figures for a set of receipts.
 *
 * Returns carry a negative total in Billz, so netting is a plain sum and gross
 * is the positive half. Keeping both means "we sold 12m and refunded 400k" can
 * be said, which a single net figure hides.
 *
 * The average order value divides by *sales*, not by receipts: including
 * returns in the denominator would drag the average down every time somebody
 * brought something back, which is not what anybody means by "average basket".
 */
export const calculateMetrics = (receipts: NormalisedReceipt[]): AnalyticsMetricSet => {
  let grossSales = 0;
  let returnsTotal = 0;
  let saleCount = 0;
  let returnCount = 0;
  let unitsSold = 0;
  let outstandingDebt = 0;

  for (const receipt of receipts) {
    if (receipt.isReturn) {
      returnCount += 1;
      // Stored negative; reported as a positive amount refunded.
      returnsTotal += Math.abs(receipt.total);
    } else {
      saleCount += 1;
      grossSales += receipt.total;
    }

    outstandingDebt += receipt.debtAmount;

    for (const line of receipt.lines) {
      unitsSold += receipt.isReturn ? -line.quantity : line.quantity;
    }
  }

  const netSales = grossSales - returnsTotal;

  return {
    grossSales,
    netSales,
    returnsTotal,
    saleCount,
    returnCount,
    unitsSold,
    // Guarded rather than left to produce `NaN` on a period with no sales.
    averageOrderValue: saleCount === 0 ? 0 : Math.round(grossSales / saleCount),
    outstandingDebt,
  };
};

/**
 * Takings per calendar day, in the actor's zone.
 *
 * Days with no trade are filled in as zeroes rather than omitted. A baseline
 * built only from days that had sales would quietly exclude the closed Sunday
 * that is the very thing an anomaly check should see.
 */
export const buildDailySeries = (
  receipts: NormalisedReceipt[],
  days: string[],
): AnalyticsDailyPoint[] => {
  const byDay = new Map<string, AnalyticsDailyPoint>(
    days.map((date) => [date, { date, revenue: 0, saleCount: 0 }]),
  );

  for (const receipt of receipts) {
    const point = byDay.get(receipt.localDate);

    if (!point) {
      // A receipt outside the requested window; the caller's range is what
      // defines the report, not whatever the upstream happened to return.
      continue;
    }

    point.revenue += receipt.total;

    if (!receipt.isReturn) {
      point.saleCount += 1;
    }
  }

  return [...byDay.values()].sort((left, right) => left.date.localeCompare(right.date));
};

interface Aggregate {
  name: string;
  externalId: string | null;
  revenue: number;
  units: number;
  saleCount: number;
}

const rank = (aggregates: Map<string, Aggregate>, netSales: number, limit: number) =>
  [...aggregates.values()]
    .sort((left, right) => right.revenue - left.revenue)
    .slice(0, limit)
    .map<AnalyticsRanking>((entry) => ({
      name: entry.name,
      externalId: entry.externalId,
      revenue: entry.revenue,
      units: entry.units,
      saleCount: entry.saleCount,
      // Share is undefined against a zero or negative net, not zero: a period
      // that broke even has no meaningful denominator.
      shareOfRevenue:
        netSales > 0
          ? Math.round(((entry.revenue / netSales) * 100 + Number.EPSILON) * 100) / 100
          : null,
    }));

/**
 * Revenue by product, best first.
 *
 * Built from line items rather than from receipt totals, because a receipt with
 * four products tells you nothing about which of them earned the money. Returned
 * lines subtract, so a product that was sold and brought back nets to nothing
 * instead of appearing as a bestseller.
 */
export const rankProducts = (
  receipts: NormalisedReceipt[],
  limit = ANALYTICS_MAX_RANKING,
): AnalyticsRanking[] => {
  const aggregates = new Map<string, Aggregate>();
  let netSales = 0;

  for (const receipt of receipts) {
    netSales += receipt.total;

    for (const line of receipt.lines) {
      const key = line.productExternalId ?? `name:${line.name}`;
      const entry = aggregates.get(key) ?? {
        name: line.name,
        externalId: line.productExternalId,
        revenue: 0,
        units: 0,
        saleCount: 0,
      };

      const sign = receipt.isReturn ? -1 : 1;

      entry.revenue += sign * line.lineTotal;
      entry.units += sign * line.quantity;
      entry.saleCount += receipt.isReturn ? 0 : 1;
      aggregates.set(key, entry);
    }
  }

  return rank(aggregates, netSales, limit);
};

/** Revenue by branch, using the shop each receipt was rung up at. */
export const rankBranches = (
  receipts: NormalisedReceipt[],
  limit = ANALYTICS_MAX_RANKING,
): AnalyticsRanking[] => {
  const aggregates = new Map<string, Aggregate>();
  let netSales = 0;

  for (const receipt of receipts) {
    netSales += receipt.total;

    const key = receipt.shopExternalId ?? `name:${receipt.shopName ?? 'unknown'}`;
    const entry = aggregates.get(key) ?? {
      name: receipt.shopName ?? 'Unknown branch',
      externalId: receipt.shopExternalId,
      revenue: 0,
      units: 0,
      saleCount: 0,
    };

    entry.revenue += receipt.total;
    entry.units += receipt.lines.reduce(
      (sum, line) => sum + (receipt.isReturn ? -line.quantity : line.quantity),
      0,
    );
    entry.saleCount += receipt.isReturn ? 0 : 1;
    aggregates.set(key, entry);
  }

  return rank(aggregates, netSales, limit);
};

/** Revenue by category, for products whose category Billz records. */
export const rankCategories = (
  receipts: NormalisedReceipt[],
  categoryOf: (productExternalId: string | null) => string | null,
  limit = ANALYTICS_MAX_RANKING,
): AnalyticsRanking[] => {
  const aggregates = new Map<string, Aggregate>();
  let netSales = 0;

  for (const receipt of receipts) {
    netSales += receipt.total;

    for (const line of receipt.lines) {
      const category = categoryOf(line.productExternalId);

      if (!category) {
        // Uncategorised stock is left out rather than bundled into an
        // "Other" row that would compete with real categories in a ranking.
        continue;
      }

      const entry = aggregates.get(category) ?? {
        name: category,
        externalId: null,
        revenue: 0,
        units: 0,
        saleCount: 0,
      };

      const sign = receipt.isReturn ? -1 : 1;

      entry.revenue += sign * line.lineTotal;
      entry.units += sign * line.quantity;
      entry.saleCount += receipt.isReturn ? 0 : 1;
      aggregates.set(category, entry);
    }
  }

  return rank(aggregates, netSales, limit);
};

/**
 * What accounts for the difference between two periods.
 *
 * This is the difference between "revenue fell 100m" and "revenue fell 100m,
 * and 45m of that was one product" — the second is the one somebody can act on.
 *
 * `shareOfChange` is measured against the *total movement*, so the shares of a
 * list of movers in the same direction sum to roughly 100. It is deliberately
 * `null` when the total change is zero: individual things still moved, but
 * "share of nothing" is not a number.
 *
 * Note this describes composition, never causation. A product being the largest
 * mover says it accounts for the arithmetic, not that it explains it.
 */
export const findTopContributors = (options: {
  current: AnalyticsRanking[];
  previous: AnalyticsRanking[];
  dimension: AnalyticsContributor['dimension'];
  limit?: number;
  /** Movers below this share of the total are dropped as noise. */
  minSharePercent?: number;
}): AnalyticsContributor[] => {
  const previousByName = new Map(options.previous.map((row) => [row.name, row]));
  const names = new Set([
    ...options.current.map((row) => row.name),
    ...options.previous.map((row) => row.name),
  ]);

  const totalMovement = [...names].reduce((sum, name) => {
    const current = options.current.find((row) => row.name === name)?.revenue ?? 0;
    const previous = previousByName.get(name)?.revenue ?? 0;

    return sum + Math.abs(current - previous);
  }, 0);

  const minShare = options.minSharePercent ?? 0;

  return (
    [...names]
      .map<AnalyticsContributor>((name) => {
        const current = options.current.find((row) => row.name === name)?.revenue ?? 0;
        const previous = previousByName.get(name)?.revenue ?? 0;
        const absoluteChange = current - previous;

        return {
          name,
          dimension: options.dimension,
          current,
          previous,
          absoluteChange,
          percentageChange: roundPercent(percentageChange(current, previous)),
          shareOfChange:
            totalMovement > 0
              ? Math.round((Math.abs(absoluteChange) / totalMovement) * 10_000) / 100
              : null,
        };
      })
      .filter(
        (contributor) =>
          contributor.absoluteChange !== 0 && (contributor.shareOfChange ?? 0) >= minShare,
      )
      // Largest mover first regardless of direction: the question is "what moved",
      // and the biggest fall matters as much as the biggest rise.
      .sort((left, right) => Math.abs(right.absoluteChange) - Math.abs(left.absoluteChange))
      .slice(0, options.limit ?? 5)
  );
};
