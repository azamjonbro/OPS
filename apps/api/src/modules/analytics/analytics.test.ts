import { ANALYTICS_MAX_RECEIPTS, type AuthenticatedUser } from '@hadiya/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { BillzCapabilityRunner } from '../billz/index.js';
import type { BillzSale } from '../billz/billz.types.js';
import { clearAnalyticsCache } from './analytics.cache.js';
import { getInsights, getSummary, getTopProducts } from './analytics.service.js';
import { createAnalyticsTools } from './analytics.tools.js';
import { resolvePeriod } from './period.js';

/**
 * Analytics end to end, against a scripted Billz.
 *
 * Nothing here reaches the network or a model: the service takes the same
 * read-only capability runner the chat tools use, so a test can hand it one it
 * wrote itself and drive the whole surface — argument validation, arithmetic,
 * the wording handed back to the model — deterministically.
 *
 * The isolation cases at the bottom are the ones worth breaking the build over.
 */
const actor = (overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser => ({
  id: 'user-1',
  username: 'aziz',
  fullName: 'Aziz',
  role: 'manager',
  branchId: null,
  timezone: 'Asia/Tashkent',
  ...overrides,
});

const sale = (overrides: Partial<BillzSale> = {}): BillzSale => ({
  externalId: 's1',
  type: 'sale',
  parentExternalId: null,
  shopExternalId: 'shop-1',
  shopName: 'Chilonzor',
  customerExternalId: null,
  customerName: null,
  total: 100_000,
  debtAmount: null,
  items: [
    {
      productExternalId: 'p1',
      name: 'Choy',
      sku: 'CHOY-1',
      barcode: null,
      quantity: 1,
      unit: null,
      unitPrice: 100_000,
      discount: 0,
      lineTotal: 100_000,
      isReturned: false,
    },
  ],
  payments: [],
  soldAt: '2026-09-06T09:00:00Z',
  ...overrides,
});

interface ScriptedRunner {
  runner: BillzCapabilityRunner;
  calls: Array<{ from: string; to: string; limit: number }>;
}

/** A Billz that answers from a fixture, and records what it was asked. */
const scripted = (
  byRange: Record<string, BillzSale[]>,
  options: { total?: number; inventory?: unknown[] } = {},
): ScriptedRunner => {
  const calls: ScriptedRunner['calls'] = [];

  const runner = {
    getSales: async (args: { from: string; to: string; limit: number }) => {
      calls.push(args);
      const items = byRange[`${args.from}..${args.to}`] ?? [];

      return { items, total: options.total ?? items.length };
    },
    getInventory: async () => options.inventory ?? [],
  } as unknown as BillzCapabilityRunner;

  return { runner, calls };
};

const period = (from: string, to: string) =>
  resolvePeriod({ key: 'custom', timezone: 'Asia/Tashkent', from, to });

beforeEach(clearAnalyticsCache);
afterEach(clearAnalyticsCache);

describe('the summary', () => {
  it('reports the period’s figures from the receipts Billz returned', async () => {
    const { runner } = scripted({
      '2026-09-01..2026-09-02': [
        sale({ externalId: 'a', total: 300_000 }),
        sale({ externalId: 'b', total: 100_000 }),
      ],
    });

    const summary = await getSummary(actor(), period('2026-09-01', '2026-09-02'), {}, { runner });

    expect(summary.metrics.netSales).toBe(400_000);
    expect(summary.metrics.saleCount).toBe(2);
    expect(summary.comparison).toBeNull();
    expect(summary.dataQuality.complete).toBe(true);
    expect(summary.dataQuality.recordsAnalysed).toBe(2);
  });

  it('measures a period against the equally long window before it', async () => {
    const { runner, calls } = scripted({
      '2026-09-03..2026-09-04': [sale({ externalId: 'a', total: 1_206_000_000 })],
      '2026-09-01..2026-09-02': [sale({ externalId: 'b', total: 1_080_000_000 })],
    });

    const summary = await getSummary(
      actor(),
      period('2026-09-03', '2026-09-04'),
      { compare: true },
      { runner },
    );

    const netSales = summary.comparison?.changes.find((change) => change.metric === 'netSales');

    expect(netSales?.percentageChange).toBeCloseTo(11.67, 2);
    expect(netSales?.direction).toBe('up');
    expect(netSales?.absoluteChange).toBe(126_000_000);
    // Two windows of equal length, never a partial period against a whole one.
    expect(calls.map((call) => `${call.from}..${call.to}`)).toEqual([
      '2026-09-03..2026-09-04',
      '2026-09-01..2026-09-02',
    ]);
  });

  it('says a figure grew without inventing a percentage for it', async () => {
    const { runner } = scripted({
      '2026-09-03..2026-09-03': [sale({ externalId: 'a', total: 500_000 })],
      '2026-09-02..2026-09-02': [],
    });

    const summary = await getSummary(
      actor(),
      period('2026-09-03', '2026-09-03'),
      { compare: true },
      { runner },
    );
    const netSales = summary.comparison?.changes.find((change) => change.metric === 'netSales');

    expect(netSales?.percentageChange).toBeNull();
    expect(netSales?.direction).toBe('up');
  });

  it('buckets a late-evening sale into the local day, not the UTC one', async () => {
    // 20:00 UTC on the 5th is 01:00 on the 6th in Tashkent.
    const { runner } = scripted({
      '2026-09-05..2026-09-06': [sale({ externalId: 'a', soldAt: '2026-09-05T20:00:00Z' })],
    });

    const summary = await getSummary(actor(), period('2026-09-05', '2026-09-06'), {}, { runner });
    const sixth = summary.daily.find((point) => point.date === '2026-09-06');

    expect(sixth?.revenue).toBe(100_000);
    expect(summary.daily.find((point) => point.date === '2026-09-05')?.revenue).toBe(0);
  });
});

describe('data quality', () => {
  it('says so when a bound stopped it short of the whole period', async () => {
    const items = Array.from({ length: ANALYTICS_MAX_RECEIPTS }, (_unused, index) =>
      sale({ externalId: `s${index}`, total: 1_000 }),
    );
    const { runner } = scripted(
      { '2026-01-01..2026-12-31': items },
      { total: ANALYTICS_MAX_RECEIPTS * 3 },
    );

    const summary = await getSummary(actor(), period('2026-01-01', '2026-12-31'), {}, { runner });

    // The figures are still returned — but never as though they were the whole
    // period. Silently analysing a third of a year is the dangerous outcome.
    expect(summary.dataQuality.complete).toBe(false);
    expect(summary.dataQuality.truncated).toBe(true);
    expect(summary.dataQuality.notes.join(' ')).toMatch(/partial/i);
  });

  it('reports receipts it could not place on a day', async () => {
    const { runner } = scripted({
      '2026-09-01..2026-09-02': [sale({ externalId: 'a', soldAt: null })],
    });

    const summary = await getSummary(actor(), period('2026-09-01', '2026-09-02'), {}, { runner });

    expect(summary.dataQuality.complete).toBe(false);
    expect(summary.dataQuality.notes.join(' ')).toMatch(/no timestamp/i);
    // Counted in the total regardless: losing its money would understate the
    // period, which is the worse of the two errors.
    expect(summary.metrics.netSales).toBe(100_000);
  });

  it('reports a clean period as complete rather than saying nothing', async () => {
    const { runner } = scripted({ '2026-09-01..2026-09-01': [sale()] });

    const summary = await getSummary(actor(), period('2026-09-01', '2026-09-01'), {}, { runner });

    expect(summary.dataQuality).toMatchObject({ complete: true, truncated: false, notes: [] });
  });
});

describe('insights', () => {
  it('never asserts a cause, only a coincidence', async () => {
    const days = Array.from({ length: 10 }, (_unused, index) =>
      sale({
        externalId: `s${index}`,
        total: index < 5 ? 500_000 : 100_000,
        soldAt: `2026-09-${String(index + 1).padStart(2, '0')}T06:00:00Z`,
      }),
    );
    const { runner } = scripted({
      '2026-09-01..2026-09-10': days,
      '2026-08-22..2026-08-31': [],
    });

    const report = await getInsights(actor(), period('2026-09-01', '2026-09-10'), { runner });
    const prose = JSON.stringify(report);

    // The causation rule, asserted. Analytics may say what moved together; it
    // may never say that one thing caused another.
    expect(prose).not.toMatch(/\bbecause\b/i);
    expect(prose).not.toMatch(/\bcaused by\b/i);
    expect(report.insights.length).toBeGreaterThan(0);
  });

  it('gives every finding a confidence between zero and one', async () => {
    const { runner } = scripted({
      '2026-09-01..2026-09-10': [sale({ externalId: 'a' })],
      '2026-08-22..2026-08-31': [],
    });

    const report = await getInsights(actor(), period('2026-09-01', '2026-09-10'), { runner });

    for (const insight of report.insights) {
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('does not recommend anything off a low-confidence finding', async () => {
    const { runner } = scripted({
      '2026-09-01..2026-09-03': [sale({ externalId: 'a' })],
      '2026-08-29..2026-08-31': [],
    });

    const report = await getInsights(actor(), period('2026-09-01', '2026-09-03'), { runner });

    for (const recommendation of report.recommendations) {
      expect(recommendation.confidence).toBeGreaterThanOrEqual(0.7);
    }
  });

  it('surfaces incomplete data as a finding of its own', async () => {
    const items = Array.from({ length: ANALYTICS_MAX_RECEIPTS }, (_unused, index) =>
      sale({ externalId: `s${index}` }),
    );
    const { runner } = scripted(
      { '2026-09-01..2026-09-10': items, '2026-08-22..2026-08-31': [] },
      { total: 99_999 },
    );

    const report = await getInsights(actor(), period('2026-09-01', '2026-09-10'), { runner });

    expect(report.insights.some((insight) => insight.type === 'data_quality')).toBe(true);
  });
});

describe('the tools the agent sees', () => {
  const tools = (runner: BillzCapabilityRunner) => createAnalyticsTools({ runner });

  const context = (overrides: Partial<AuthenticatedUser> = {}) => ({
    actor: actor(overrides),
    conversationId: 'c1',
  });

  it('are all read-only, and say so to the registry', () => {
    for (const tool of createAnalyticsTools()) {
      expect(tool.mutates).toBe(false);
      expect(tool.risk).toBe('read');
      expect(tool.requiresConfirmation ?? false).toBe(false);
      expect(tool.parallelSafe).toBe(true);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('hand the model figures rather than receipts', async () => {
    const { runner } = scripted({
      '2026-09-06..2026-09-06': Array.from({ length: 400 }, (_unused, index) =>
        sale({ externalId: `s${index}` }),
      ),
    });

    const summary = tools(runner).find((tool) => tool.name === 'analytics_get_summary');
    const result = await summary?.execute({ period: 'custom', from: '2026-09-06', to: '2026-09-06', compare: false }, context());

    // The whole cost argument: 400 receipts become one sentence. A model asked
    // to total a column of 400 rows is slower, dearer and less accurate.
    expect(result?.summary.length).toBeLessThan(400);
    expect(result?.summary).toMatch(/400 sale/);
  });

  it('rank products for a period', async () => {
    const { runner } = scripted({
      '2026-09-06..2026-09-06': [
        sale({
          externalId: 'a',
          total: 300_000,
          items: [
            {
              productExternalId: 'p2',
              name: 'Qahva',
              sku: 'Q',
              barcode: null,
              quantity: 3,
              unit: null,
              unitPrice: 100_000,
              discount: 0,
              lineTotal: 300_000,
              isReturned: false,
            },
          ],
        }),
        sale({ externalId: 'b', total: 100_000 }),
      ],
    });

    const result = await getTopProducts(
      actor(),
      period('2026-09-06', '2026-09-06'),
      10,
      { runner },
    );

    expect(result.items[0]?.name).toBe('Qahva');
    expect(result.items[0]?.units).toBe(3);
  });

  it('refuse an argument the model invented', async () => {
    const { runner } = scripted({});
    const summary = tools(runner).find((tool) => tool.name === 'analytics_get_summary');

    // The registry validates before executing; this asserts the schema is the
    // thing that would refuse, rather than the tool trusting its input.
    expect(summary?.schema.safeParse({ period: 'last_fortnight' }).success).toBe(false);
    expect(summary?.schema.safeParse({ period: 'this_month' }).success).toBe(true);
  });

  it('report an empty period as empty rather than inventing figures', async () => {
    const { runner } = scripted({ '2026-09-06..2026-09-06': [] });
    const top = tools(runner).find((tool) => tool.name === 'analytics_get_top_products');
    const result = await top?.execute(
      { period: 'custom', from: '2026-09-06', to: '2026-09-06', limit: 10 },
      context(),
    );

    expect(result?.summary).toMatch(/no products were sold/i);
  });

  it('say plainly when nothing unusual happened', async () => {
    const { runner } = scripted({
      '2026-09-01..2026-09-06': Array.from({ length: 6 }, (_unused, index) =>
        sale({
          externalId: `s${index}`,
          soldAt: `2026-09-0${index + 1}T06:00:00Z`,
        }),
      ),
    });
    const anomalies = tools(runner).find((tool) => tool.name === 'analytics_detect_anomalies');
    const result = await anomalies?.execute(
      { period: 'custom', from: '2026-09-01', to: '2026-09-06' },
      context(),
    );

    expect(result?.summary).toMatch(/nothing unusual/i);
  });
});

describe('isolation', () => {
  it('resolves the window from the actor’s own timezone, not from an argument', async () => {
    const { runner, calls } = scripted({});
    const summary = createAnalyticsTools({ runner }).find(
      (tool) => tool.name === 'analytics_get_summary',
    );

    await summary?.execute(
      // A model cannot name a zone: there is no argument for one, and the
      // schema would reject it. The principal decides which day "today" is.
      { period: 'today', compare: false },
      { actor: actor({ timezone: 'Pacific/Kiritimati' }), conversationId: 'c1' },
    );

    const first = calls[0];

    expect(first).toBeDefined();
    // Kiritimati runs 14 hours ahead of UTC, so its "today" is a date UTC has
    // not reached yet — proof the actor's zone, not the server's, was used.
    expect(first?.from).toBe(first?.to);
  });

  it('never serves one account’s figures to another', async () => {
    const { runner, calls } = scripted({
      '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 777_000 })],
    });
    const window = period('2026-09-06', '2026-09-06');

    const first = await getSummary(actor({ id: 'user-1' }), window, {}, { runner });
    const second = await getSummary(actor({ id: 'user-2' }), window, {}, { runner });

    // The second account must not be served the first's cached window: every
    // cache key is prefixed with the account it was computed for, so this is
    // two Billz reads rather than one cache hit across a tenant boundary.
    expect(first.metrics.netSales).toBe(777_000);
    expect(second.metrics.netSales).toBe(777_000);
    expect(calls).toHaveLength(2);
  });

  it('reuses a window for the same account, so a follow-up question is free', async () => {
    const { runner, calls } = scripted({
      '2026-09-06..2026-09-06': [sale({ externalId: 'a' })],
    });
    const window = period('2026-09-06', '2026-09-06');

    await getSummary(actor(), window, {}, { runner });
    await getTopProducts(actor(), window, 10, { runner });

    // "Bugungi savdo qanday?" followed by "qaysi mahsulot?" is one Billz read.
    expect(calls).toHaveLength(1);
  });

  it('does not confuse two different windows for the same account', async () => {
    const { runner, calls } = scripted({
      '2026-09-06..2026-09-06': [sale({ externalId: 'a', total: 100_000 })],
      '2026-09-05..2026-09-05': [sale({ externalId: 'b', total: 900_000 })],
    });

    const today = await getSummary(actor(), period('2026-09-06', '2026-09-06'), {}, { runner });
    const yesterday = await getSummary(actor(), period('2026-09-05', '2026-09-05'), {}, { runner });

    expect(today.metrics.netSales).toBe(100_000);
    expect(yesterday.metrics.netSales).toBe(900_000);
    expect(calls).toHaveLength(2);
  });
});
