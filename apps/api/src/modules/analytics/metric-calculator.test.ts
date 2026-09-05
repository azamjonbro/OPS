import { describe, expect, it } from 'vitest';

import type { NormalisedReceipt } from './analytics.types.js';
import {
  buildDailySeries,
  calculateMetrics,
  compareMetric,
  directionOf,
  findTopContributors,
  percentageChange,
  rankBranches,
  rankProducts,
} from './metric-calculator.js';

/**
 * The arithmetic, checked against the cases that actually go wrong.
 *
 * Nothing here touches Billz or a model: these are pure functions, and the
 * whole reason the calculators were separated from the service is that the
 * numbers a shopkeeper acts on should be verifiable without a network.
 */
const receipt = (overrides: Partial<NormalisedReceipt> = {}): NormalisedReceipt => ({
  externalId: 'r1',
  isReturn: false,
  total: 100_000,
  debtAmount: 0,
  shopExternalId: 'shop-1',
  shopName: 'Chilonzor',
  customerExternalId: null,
  localDate: '2026-09-01',
  lines: [
    { productExternalId: 'p1', name: 'Choy', quantity: 2, lineTotal: 100_000 },
  ],
  ...overrides,
});

describe('percentage change', () => {
  it('computes growth without the answer being written into the test', () => {
    const current = 1_206_000_000;
    const previous = 1_080_000_000;

    // Derived here rather than pasted, so the assertion cannot silently agree
    // with a wrong implementation that happens to match a hardcoded string.
    const expected = ((current - previous) / previous) * 100;

    expect(percentageChange(current, previous)).toBeCloseTo(expected, 10);
    expect(percentageChange(current, previous)).toBeCloseTo(11.6666666, 6);
  });

  it('reports a total collapse as -100%', () => {
    expect(percentageChange(0, 100_000_000)).toBe(-100);
  });

  it('refuses to invent a percentage when there was nothing to grow from', () => {
    // The case that produces `Infinity` in every naive implementation. Growth
    // from zero is a real event but not a percentage, and both `Infinity` and
    // `+100` would be confident-looking falsehoods.
    expect(percentageChange(100_000_000, 0)).toBeNull();
    expect(Number.isFinite(percentageChange(100_000_000, 0) ?? 0)).toBe(true);
  });

  it('treats nothing-to-nothing as having no percentage either', () => {
    expect(percentageChange(0, 0)).toBeNull();
  });

  it('refuses a negative base, where the sign would be meaningless', () => {
    // A period that netted a refund. "-250% better" helps nobody.
    expect(percentageChange(50_000, -20_000)).toBeNull();
  });

  it('handles a decline', () => {
    expect(percentageChange(80, 100)).toBeCloseTo(-20, 10);
  });
});

describe('direction', () => {
  it('is read from the absolute change, so a move from zero still has one', () => {
    expect(directionOf(5)).toBe('up');
    expect(directionOf(-5)).toBe('down');
    expect(directionOf(0)).toBe('flat');
  });

  it('says a figure rose even where no percentage exists', () => {
    const comparison = compareMetric({
      metric: 'netSales',
      label: 'Net sales',
      current: 100_000,
      previous: 0,
      money: true,
    });

    expect(comparison.percentageChange).toBeNull();
    expect(comparison.direction).toBe('up');
    expect(comparison.absoluteChange).toBe(100_000);
  });
});

describe('period metrics', () => {
  it('nets returns out of gross without double-counting them', () => {
    const metrics = calculateMetrics([
      receipt({ externalId: 'a', total: 300_000 }),
      receipt({ externalId: 'b', total: 200_000 }),
      receipt({
        externalId: 'c',
        isReturn: true,
        total: -100_000,
        lines: [{ productExternalId: 'p1', name: 'Choy', quantity: 1, lineTotal: 100_000 }],
      }),
    ]);

    expect(metrics.grossSales).toBe(500_000);
    expect(metrics.returnsTotal).toBe(100_000);
    expect(metrics.netSales).toBe(400_000);
    expect(metrics.saleCount).toBe(2);
    expect(metrics.returnCount).toBe(1);
  });

  it('averages the basket over sales, not over returns', () => {
    const metrics = calculateMetrics([
      receipt({ externalId: 'a', total: 300_000 }),
      receipt({ externalId: 'b', total: 100_000 }),
      receipt({ externalId: 'c', isReturn: true, total: -50_000, lines: [] }),
    ]);

    // 400 000 over two sales. Including the return in the denominator would
    // drag the average down every time somebody brought something back.
    expect(metrics.averageOrderValue).toBe(200_000);
  });

  it('does not divide by zero on a period with no sales', () => {
    const metrics = calculateMetrics([]);

    expect(metrics.averageOrderValue).toBe(0);
    expect(Number.isNaN(metrics.averageOrderValue)).toBe(false);
    expect(metrics.netSales).toBe(0);
  });

  it('subtracts returned units from the units sold', () => {
    const metrics = calculateMetrics([
      receipt({ externalId: 'a', lines: [{ productExternalId: 'p1', name: 'Choy', quantity: 5, lineTotal: 250_000 }] }),
      receipt({
        externalId: 'b',
        isReturn: true,
        total: -50_000,
        lines: [{ productExternalId: 'p1', name: 'Choy', quantity: 1, lineTotal: 50_000 }],
      }),
    ]);

    expect(metrics.unitsSold).toBe(4);
  });

  it('totals what is still owed', () => {
    const metrics = calculateMetrics([
      receipt({ externalId: 'a', debtAmount: 40_000 }),
      receipt({ externalId: 'b', debtAmount: 10_000 }),
    ]);

    expect(metrics.outstandingDebt).toBe(50_000);
  });
});

describe('the daily series', () => {
  it('fills in the days nothing was sold', () => {
    const series = buildDailySeries(
      [receipt({ localDate: '2026-09-01' }), receipt({ externalId: 'b', localDate: '2026-09-03' })],
      ['2026-09-01', '2026-09-02', '2026-09-03'],
    );

    // A closed Sunday is exactly the day an anomaly check needs to see; a
    // series built only from days with trade would omit it.
    expect(series.map((point) => point.date)).toEqual([
      '2026-09-01',
      '2026-09-02',
      '2026-09-03',
    ]);
    expect(series[1]?.revenue).toBe(0);
    expect(series[1]?.saleCount).toBe(0);
  });

  it('ignores a receipt outside the requested window', () => {
    const series = buildDailySeries([receipt({ localDate: '2026-08-30' })], ['2026-09-01']);

    // The caller's range defines the report, not whatever the upstream returned.
    expect(series).toHaveLength(1);
    expect(series[0]?.revenue).toBe(0);
  });
});

describe('rankings', () => {
  it('ranks products by revenue and nets returned lines out', () => {
    const ranked = rankProducts([
      receipt({
        externalId: 'a',
        total: 300_000,
        lines: [
          { productExternalId: 'p1', name: 'Choy', quantity: 2, lineTotal: 200_000 },
          { productExternalId: 'p2', name: 'Qahva', quantity: 1, lineTotal: 100_000 },
        ],
      }),
      receipt({
        externalId: 'b',
        isReturn: true,
        total: -200_000,
        lines: [{ productExternalId: 'p1', name: 'Choy', quantity: 2, lineTotal: 200_000 }],
      }),
    ]);

    // Choy was sold and brought straight back; it must not lead the ranking.
    expect(ranked[0]?.name).toBe('Qahva');
    expect(ranked.find((row) => row.name === 'Choy')?.revenue).toBe(0);
  });

  it('ranks branches by takings', () => {
    const ranked = rankBranches([
      receipt({ externalId: 'a', shopExternalId: 's1', shopName: 'Chilonzor', total: 100_000 }),
      receipt({ externalId: 'b', shopExternalId: 's2', shopName: 'Yunusobod', total: 400_000 }),
    ]);

    expect(ranked.map((row) => row.name)).toEqual(['Yunusobod', 'Chilonzor']);
    expect(ranked[0]?.shareOfRevenue).toBe(80);
  });

  it('leaves share undefined when the period did not net a positive total', () => {
    const ranked = rankBranches([
      receipt({ externalId: 'a', isReturn: true, total: -100_000, lines: [] }),
    ]);

    // A period that only refunded has no denominator worth dividing by.
    expect(ranked[0]?.shareOfRevenue).toBeNull();
  });
});

describe('top contributors', () => {
  it('names what accounts for a fall, largest mover first', () => {
    const contributors = findTopContributors({
      current: [
        { name: 'A', externalId: 'a', revenue: 55_000_000, units: 5, saleCount: 5, shareOfRevenue: null },
        { name: 'B', externalId: 'b', revenue: 75_000_000, units: 7, saleCount: 7, shareOfRevenue: null },
      ],
      previous: [
        { name: 'A', externalId: 'a', revenue: 100_000_000, units: 9, saleCount: 9, shareOfRevenue: null },
        { name: 'B', externalId: 'b', revenue: 100_000_000, units: 9, saleCount: 9, shareOfRevenue: null },
      ],
      dimension: 'product',
    });

    expect(contributors[0]?.name).toBe('A');
    expect(contributors[0]?.absoluteChange).toBe(-45_000_000);
    expect(contributors[1]?.absoluteChange).toBe(-25_000_000);
    // 45 of the 70 that moved.
    expect(contributors[0]?.shareOfChange).toBeCloseTo(64.29, 1);
  });

  it('counts a product that appeared where there was none before', () => {
    const contributors = findTopContributors({
      current: [
        { name: 'New', externalId: 'n', revenue: 10_000, units: 1, saleCount: 1, shareOfRevenue: null },
      ],
      previous: [],
      dimension: 'product',
    });

    expect(contributors[0]?.absoluteChange).toBe(10_000);
    // It grew from nothing, so there is no percentage — but it still ranks.
    expect(contributors[0]?.percentageChange).toBeNull();
  });

  it('drops movers below the noise threshold', () => {
    const contributors = findTopContributors({
      current: [
        { name: 'Big', externalId: 'a', revenue: 200_000, units: 1, saleCount: 1, shareOfRevenue: null },
        { name: 'Tiny', externalId: 'b', revenue: 1_001, units: 1, saleCount: 1, shareOfRevenue: null },
      ],
      previous: [
        { name: 'Big', externalId: 'a', revenue: 100_000, units: 1, saleCount: 1, shareOfRevenue: null },
        { name: 'Tiny', externalId: 'b', revenue: 1_000, units: 1, saleCount: 1, shareOfRevenue: null },
      ],
      dimension: 'product',
      minSharePercent: 5,
    });

    expect(contributors.map((entry) => entry.name)).toEqual(['Big']);
  });
});
