import type { AnalyticsPeriod, ResolvedAlertRule } from '@hadiya/shared';
import { describe, expect, it } from 'vitest';

import {
  clearsThreshold,
  detectBranchChanges,
  detectLowStock,
  detectMetricChange,
  severityFor,
} from './detector.js';

/**
 * Whether something is worth telling somebody about.
 *
 * Pure functions, so these run without a database, without Billz and without a
 * model — which is the point: the decision to interrupt a person's day is
 * arithmetic, and arithmetic should be checkable.
 */
const period = (overrides: Partial<AnalyticsPeriod> = {}): AnalyticsPeriod => ({
  key: 'today',
  from: '2026-09-06',
  to: '2026-09-06',
  timezone: 'Asia/Tashkent',
  days: 1,
  label: 'today',
  ...overrides,
});

const rule = (overrides: Partial<ResolvedAlertRule> = {}): ResolvedAlertRule => ({
  type: 'REVENUE_DROP',
  metric: 'netSales',
  scope: 'business',
  thresholdPercent: -20,
  minObservations: 1,
  baseSeverity: 'medium',
  cooldownMs: 86_400_000,
  enabled: true,
  ...overrides,
});

const money = (value: number): string => String(value);

describe('threshold evaluation', () => {
  it('fires a drop rule only on a fall past the line', () => {
    expect(clearsThreshold(-30, -20)).toBe(true);
    expect(clearsThreshold(-20, -20)).toBe(true);
    expect(clearsThreshold(-19, -20)).toBe(false);
    // A rise must never satisfy a rule named "drop", whatever its magnitude.
    expect(clearsThreshold(80, -20)).toBe(false);
  });

  it('fires a spike rule only on a rise past the line', () => {
    expect(clearsThreshold(35, 30)).toBe(true);
    expect(clearsThreshold(29, 30)).toBe(false);
    expect(clearsThreshold(-90, 30)).toBe(false);
  });

  it('never fires on a change that has no percentage', () => {
    // Growth from a zero base. A real event, but not a percentage — and
    // comparing null against a threshold would either throw or quietly pass.
    expect(clearsThreshold(null, -20)).toBe(false);
    expect(clearsThreshold(null, 30)).toBe(false);
  });
});

describe('severity', () => {
  it('stays at the rule’s base for a change that just clears it', () => {
    expect(severityFor(-22, rule())).toBe('medium');
  });

  it('rises as the change outruns the threshold', () => {
    expect(severityFor(-38, rule())).toBe('high');
    expect(severityFor(-60, rule())).toBe('critical');
  });

  it('does not make everything critical', () => {
    // The failure mode this guards: a system where every alert is critical has
    // no way left to say that something actually is.
    expect(severityFor(-21, rule())).not.toBe('critical');
    expect(severityFor(-30, rule())).not.toBe('critical');
  });

  it('cannot climb past critical', () => {
    expect(severityFor(-5_000, rule())).toBe('critical');
  });
});

describe('a business metric moving', () => {
  it('raises an alert when revenue falls past the threshold', () => {
    const candidate = detectMetricChange({
      rule: rule(),
      label: 'Revenue',
      currentValue: 70_000_000,
      previousValue: 100_000_000,
      changePercent: -30,
      periods: { period: period(), comparison: period({ from: '2026-09-05', to: '2026-09-05' }) },
      dataComplete: true,
      formatValue: money,
    });

    expect(candidate).not.toBeNull();
    expect(candidate?.type).toBe('REVENUE_DROP');
    expect(candidate?.severity).toBe('medium');
    expect(candidate?.evidence.currentValue).toBe(70_000_000);
    expect(candidate?.evidence.previousValue).toBe(100_000_000);
    expect(candidate?.evidence.changePercent).toBe(-30);
  });

  it('stays quiet on an ordinary day', () => {
    expect(
      detectMetricChange({
        rule: rule(),
        label: 'Revenue',
        currentValue: 95_000_000,
        previousValue: 100_000_000,
        changePercent: -5,
        periods: { period: period(), comparison: period() },
        dataComplete: true,
        formatValue: money,
      }),
    ).toBeNull();
  });

  it('never asserts a cause', () => {
    const candidate = detectMetricChange({
      rule: rule(),
      label: 'Revenue',
      currentValue: 10,
      previousValue: 100,
      changePercent: -90,
      periods: { period: period(), comparison: period() },
      dataComplete: true,
      formatValue: money,
    });

    const text = `${candidate?.title} ${candidate?.summary}`;

    // The causation rule, asserted mechanically rather than by review.
    expect(text).not.toMatch(/\bbecause\b/i);
    expect(text).not.toMatch(/\bcaused\b/i);
    expect(text).not.toMatch(/\bdue to\b/i);
  });

  it('says nothing when the rule is switched off', () => {
    expect(
      detectMetricChange({
        rule: rule({ enabled: false }),
        label: 'Revenue',
        currentValue: 1,
        previousValue: 100,
        changePercent: -99,
        periods: { period: period(), comparison: period() },
        dataComplete: true,
        formatValue: money,
      }),
    ).toBeNull();
  });

  it('refuses to fire on a period shorter than the rule requires', () => {
    expect(
      detectMetricChange({
        rule: rule({ minObservations: 7 }),
        label: 'Revenue',
        currentValue: 1,
        previousValue: 100,
        changePercent: -99,
        periods: { period: period({ days: 1 }), comparison: period() },
        dataComplete: true,
        formatValue: money,
      }),
    ).toBeNull();
  });

  it('records that the figures were partial rather than hiding it', () => {
    const candidate = detectMetricChange({
      rule: rule(),
      label: 'Revenue',
      currentValue: 70,
      previousValue: 100,
      changePercent: -30,
      periods: { period: period(), comparison: period() },
      dataComplete: false,
      formatValue: money,
    });

    expect(candidate?.evidence.dataComplete).toBe(false);
  });
});

describe('branches', () => {
  const branches = [
    { externalId: 'b1', name: 'Chilonzor', current: 50, previous: 100, changePercent: -50 },
    { externalId: 'b2', name: 'Yunusobod', current: 90, previous: 100, changePercent: -10 },
    { externalId: 'b3', name: 'Sergeli', current: 70, previous: 100, changePercent: -30 },
  ];

  it('raises only the branches past the line, worst first', () => {
    const found = detectBranchChanges({
      rule: rule({ type: 'BRANCH_DECLINE', scope: 'branch' }),
      branches,
      periods: { period: period(), comparison: period() },
      dataComplete: true,
      formatValue: money,
    });

    expect(found.map((entry) => entry.entity.name)).toEqual(['Chilonzor', 'Sergeli']);
    expect(found[0]?.entity.kind).toBe('branch');
    expect(found[0]?.entity.externalId).toBe('b1');
  });

  it('caps how many it will raise, so a bad day is not a dozen notifications', () => {
    const many = Array.from({ length: 12 }, (_unused, index) => ({
      externalId: `b${index}`,
      name: `Branch ${index}`,
      current: 10,
      previous: 100,
      changePercent: -90,
    }));

    expect(
      detectBranchChanges({
        rule: rule({ type: 'BRANCH_DECLINE', scope: 'branch' }),
        branches: many,
        periods: { period: period(), comparison: period() },
        dataComplete: true,
        formatValue: money,
      }).length,
    ).toBeLessThanOrEqual(5);
  });
});

describe('low stock', () => {
  const lines = [
    {
      productExternalId: 'p1',
      productName: 'Choy',
      sku: 'CHOY-1',
      shopName: 'Chilonzor',
      quantity: 0,
    },
    {
      productExternalId: 'p2',
      productName: 'Qahva',
      sku: 'QAH-1',
      shopName: 'Chilonzor',
      quantity: 2,
    },
    {
      productExternalId: 'p3',
      productName: 'Shakar',
      sku: 'SHK-1',
      shopName: 'Chilonzor',
      quantity: 40,
    },
  ];

  it('raises what is at or below the reorder line, emptiest first', () => {
    const found = detectLowStock({
      rule: rule({ type: 'LOW_STOCK', scope: 'product' }),
      lines,
      thresholdUnits: 3,
      period: period(),
    });

    // The SKU rides along, so two variants sharing a name are still legible.
    expect(found.map((entry) => entry.entity.name)).toEqual(['Choy (CHOY-1)', 'Qahva (QAH-1)']);
  });

  it('treats nothing on the shelf as worse than nearly nothing', () => {
    const found = detectLowStock({
      rule: rule({ type: 'LOW_STOCK', scope: 'product', baseSeverity: 'medium' }),
      lines,
      thresholdUnits: 3,
      period: period(),
    });

    expect(found[0]?.severity).toBe('high');
    expect(found[1]?.severity).toBe('medium');
  });

  it('carries no percentage, because a unit count is not one', () => {
    const found = detectLowStock({
      rule: rule({ type: 'LOW_STOCK', scope: 'product' }),
      lines,
      thresholdUnits: 3,
      period: period(),
    });

    expect(found[0]?.evidence.changePercent).toBeNull();
    expect(found[0]?.evidence.previousValue).toBeNull();
  });
});
