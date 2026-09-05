import type { AnalyticsDailyPoint } from '@hadiya/shared';
import { describe, expect, it } from 'vitest';

import { detectAnomalies, detectTrend, median } from './trend-analyzer.js';

/**
 * Telling a change from a wobble.
 *
 * The most valuable cases here are the negative ones. Anything can be made to
 * detect a trend; the hard part — and the thing that decides whether anybody
 * trusts the assistant twice — is not reporting one when a shop simply had a
 * good Saturday.
 */
const series = (values: number[], start = 1): AnalyticsDailyPoint[] =>
  values.map((revenue, index) => ({
    date: `2026-09-${String(start + index).padStart(2, '0')}`,
    revenue,
    saleCount: revenue > 0 ? 1 : 0,
  }));

describe('median', () => {
  it('takes the middle of an odd-length set', () => {
    expect(median([5, 1, 3])).toBe(3);
  });

  it('averages the middle pair of an even-length set', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('is unmoved by one enormous day, unlike a mean', () => {
    expect(median([10, 10, 10, 10, 10_000])).toBe(10);
  });

  it('answers zero for nothing', () => {
    expect(median([])).toBe(0);
  });
});

describe('trend detection', () => {
  it('reports a sustained rise', () => {
    const trend = detectTrend('revenue', series([100, 110, 105, 200, 210, 205]));

    expect(trend.direction).toBe('up');
    expect(trend.changePercent).toBeGreaterThan(50);
    expect(trend.confidence).toBeGreaterThan(0.4);
  });

  it('reports a sustained fall', () => {
    const trend = detectTrend('revenue', series([200, 210, 205, 100, 110, 105]));

    expect(trend.direction).toBe('down');
    expect(trend.changePercent).toBeLessThan(0);
  });

  it('calls ordinary noise flat rather than inventing a direction', () => {
    // A perfectly normal week: busier at the weekend, quieter midweek. An
    // analytics layer that announces this as a trend is one nobody reads.
    const trend = detectTrend('revenue', series([100, 96, 104, 98, 103, 101, 99]));

    expect(trend.direction).toBe('flat');
  });

  it('refuses to call a trend on too few days', () => {
    const trend = detectTrend('revenue', series([100, 500]));

    expect(trend.direction).toBe('flat');
    // Zero confidence distinguishes "steady" from "we cannot tell yet".
    expect(trend.confidence).toBe(0);
    expect(trend.observations).toBe(2);
  });

  it('takes a configurable threshold, so a quiet shop can lower it', () => {
    // A 7% rise: real, but below the default 10% threshold.
    const gentle = series([100, 100, 100, 107, 107, 107]);

    expect(detectTrend('revenue', gentle).direction).toBe('flat');
    expect(detectTrend('revenue', gentle, { trendPercent: 5 }).direction).toBe('up');
  });

  it('never reports more confidence than the evidence supports', () => {
    const short = detectTrend('revenue', series([100, 100, 300, 300]));
    const long = detectTrend(
      'revenue',
      series(Array.from({ length: 20 }, (_u, i) => (i < 10 ? 100 : 300))),
    );

    expect(long.confidence).toBeGreaterThan(short.confidence);
    expect(long.confidence).toBeLessThanOrEqual(1);
  });
});

describe('anomaly detection', () => {
  it('flags a day far below the baseline, and says by how much', () => {
    // Six ordinary days at 100m, then a collapse to 42m.
    const anomalies = detectAnomalies('revenue', series([100, 100, 100, 100, 100, 100, 42]));

    expect(anomalies).toHaveLength(1);
    expect(anomalies[0]?.direction).toBe('drop');
    expect(anomalies[0]?.baseline).toBe(100);
    expect(anomalies[0]?.deviationPercent).toBeCloseTo(-58, 5);
    expect(anomalies[0]?.severity).toBe('medium');
  });

  it('flags a spike as well as a drop', () => {
    const anomalies = detectAnomalies('revenue', series([100, 100, 100, 100, 100, 100, 400]));

    expect(anomalies[0]?.direction).toBe('spike');
    expect(anomalies[0]?.severity).toBe('high');
  });

  it('does not let the day being judged prop up its own baseline', () => {
    // With the outlier included the median would drift toward it; excluded, the
    // baseline stays at what the ordinary days actually were.
    const anomalies = detectAnomalies('revenue', series([100, 100, 100, 100, 100, 10]));

    expect(anomalies[0]?.baseline).toBe(100);
  });

  it('stays quiet on a steady period', () => {
    expect(detectAnomalies('revenue', series([100, 98, 102, 101, 99, 100]))).toEqual([]);
  });

  it('refuses to judge without enough baseline', () => {
    expect(detectAnomalies('revenue', series([100, 5]))).toEqual([]);
  });

  it('says nothing about a shop with no history rather than manufacturing a finding', () => {
    // Every other day is zero, so there is no baseline to deviate from.
    // Dividing by it would produce an "anomaly" on the one day that traded.
    expect(detectAnomalies('revenue', series([0, 0, 0, 0, 0, 500]))).toEqual([]);
  });

  it('names only the most extreme days when a period steps between two levels', () => {
    // Every one of these ten days is anomalous against the median of the other
    // nine. Reporting all ten would be arithmetically true and useless — the
    // shape of this period is a trend, and that is where it belongs.
    const stepped = series([500, 500, 500, 500, 500, 100, 100, 100, 100, 100]);
    const anomalies = detectAnomalies('revenue', stepped);

    expect(anomalies.length).toBeLessThanOrEqual(5);
    // Still returned in date order, so a reader can follow the period.
    expect([...anomalies].sort((l, r) => l.date.localeCompare(r.date))).toEqual(anomalies);
  });

  it('takes a configurable sensitivity', () => {
    const mild = series([100, 100, 100, 100, 100, 80]);

    expect(detectAnomalies('revenue', mild)).toEqual([]);
    expect(detectAnomalies('revenue', mild, { deviationPercent: 15 })).toHaveLength(1);
  });
});
