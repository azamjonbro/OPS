import {
  ANALYTICS_MAX_ANOMALIES,
  ANALYTICS_THRESHOLDS,
  type AnalyticsAnomaly,
  type AnalyticsDailyPoint,
  type AnalyticsTrend,
  type InsightSeverity,
} from '@hadiya/shared';

import { percentageChange, roundPercent } from './metric-calculator.js';

/**
 * Telling a change from a wobble.
 *
 * Retail is noisy. A shop can take a third more on Saturday than on Tuesday with
 * nothing whatsoever having changed about the business, and an analytics layer
 * that announces that as a trend teaches people to stop reading it — which
 * costs more than saying nothing would have.
 *
 * So both detectors here are deliberately conservative and, more importantly,
 * deliberately *explainable*: a median, a percentage, a threshold. Somebody can
 * check the verdict by hand. That matters more than sensitivity, because the
 * output is shown to a person who has to decide whether to act on it.
 */

export interface TrendOptions {
  /** Percent movement below which the period is called flat. */
  trendPercent?: number;
  /** Days of evidence required before any direction is claimed. */
  minObservations?: number;
}

/** The middle value. Resistant to the one enormous day a mean would follow. */
export const median = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

/**
 * Splits the window in half and compares the halves.
 *
 * Chosen over a least-squares slope because the answer has to survive being
 * explained: "the second half took 18% more than the first" is checkable by
 * anybody with the daily figures, and a regression coefficient is not. Each
 * half is summarised by its median so one exceptional day cannot carry the
 * verdict on its own.
 *
 * Confidence grows with the number of days and with how far the movement
 * exceeds the threshold — it is a measure of how much the evidence supports the
 * claim, never of how large the change was.
 */
export const detectTrend = (
  metric: string,
  series: AnalyticsDailyPoint[],
  options: TrendOptions = {},
): AnalyticsTrend => {
  const threshold = options.trendPercent ?? ANALYTICS_THRESHOLDS.trendPercent;
  const minObservations = options.minObservations ?? ANALYTICS_THRESHOLDS.minTrendObservations;
  const values = series.map((point) => point.revenue);

  if (series.length < minObservations) {
    // Not enough days to say anything. Reported as flat with no confidence
    // rather than withheld, so a caller can tell "steady" from "unknown".
    return {
      metric,
      direction: 'flat',
      changePercent: null,
      observations: series.length,
      confidence: 0,
      series,
    };
  }

  const midpoint = Math.floor(series.length / 2);
  const firstHalf = median(values.slice(0, midpoint));
  const secondHalf = median(values.slice(midpoint));
  const change = percentageChange(secondHalf, firstHalf);

  if (change === null || Math.abs(change) < threshold) {
    return {
      metric,
      direction: 'flat',
      changePercent: roundPercent(change),
      observations: series.length,
      // A confident "nothing much happened" is still a finding worth trusting,
      // provided there were enough days to see it.
      confidence: change === null ? 0.2 : 0.6,
      series,
    };
  }

  // Two independent supports for the claim: how many days it rests on, and how
  // far past the threshold it went. The floor is what clearing the threshold at
  // all is worth; the two weights carry the rest, and together they reach but
  // never exceed 1 — a confidence above certainty would be nonsense, and one
  // that silently clipped would make a strong finding indistinguishable from an
  // overwhelming one.
  const evidenceWeight = Math.min(series.length / 14, 1) * 0.4;
  const magnitudeWeight = Math.min(Math.abs(change) / (threshold * 4), 1) * 0.4;

  return {
    metric,
    direction: change > 0 ? 'up' : 'down',
    changePercent: roundPercent(change),
    observations: series.length,
    confidence: Math.round((0.2 + evidenceWeight + magnitudeWeight) * 100) / 100,
    series,
  };
};

const severityFor = (deviationPercent: number): InsightSeverity => {
  const magnitude = Math.abs(deviationPercent);

  if (magnitude >= 70) {
    return 'high';
  }

  return magnitude >= 50 ? 'medium' : 'low';
};

export interface AnomalyOptions {
  /** How far from the median counts as unusual, in percent. */
  deviationPercent?: number;
  /** Days of baseline needed before anything is called anomalous. */
  minObservations?: number;
  /** How many days to name. The rest are the trend's business, not this one's. */
  limit?: number;
}

/**
 * Days that do not look like the days around them.
 *
 * The baseline is the median of every *other* day in the window, recomputed per
 * day so that the day being judged cannot prop up its own baseline. That is the
 * whole method — no model, no training, nothing that cannot be recomputed by
 * hand from the same numbers.
 *
 * Note what this deliberately does not do: it reports that a day was unusual,
 * and never why. A drop that coincides with an empty shelf is reported as a
 * coincidence for the assistant to mention as one; asserting the cause is not
 * something this data can support.
 */
export const detectAnomalies = (
  metric: string,
  series: AnalyticsDailyPoint[],
  options: AnomalyOptions = {},
): AnalyticsAnomaly[] => {
  const threshold = options.deviationPercent ?? ANALYTICS_THRESHOLDS.anomalyPercent;
  const minObservations = options.minObservations ?? ANALYTICS_THRESHOLDS.minAnomalyObservations;

  if (series.length < minObservations) {
    return [];
  }

  const found = series.flatMap<AnalyticsAnomaly>((point, index) => {
    const others = series.filter((_unused, otherIndex) => otherIndex !== index);
    const baseline = median(others.map((entry) => entry.revenue));

    if (baseline <= 0) {
      // No baseline to deviate from. A shop with no history is not anomalous,
      // it is new, and dividing by nothing would manufacture a finding.
      return [];
    }

    const deviation = ((point.revenue - baseline) / baseline) * 100;

    if (Math.abs(deviation) < threshold) {
      return [];
    }

    return [
      {
        date: point.date,
        metric,
        value: point.revenue,
        baseline: Math.round(baseline),
        deviationPercent: Math.round(deviation * 100) / 100,
        direction: deviation > 0 ? 'spike' : 'drop',
        severity: severityFor(deviation),
      },
    ];
  });

  // A period that steps between two levels makes every day anomalous against
  // the others. That is arithmetically true and tells a shopkeeper nothing, so
  // only the most extreme are named — the shape of such a period is a *trend*,
  // and that is where it gets reported.
  return [...found]
    .sort((left, right) => Math.abs(right.deviationPercent) - Math.abs(left.deviationPercent))
    .slice(0, options.limit ?? ANALYTICS_MAX_ANOMALIES)
    .sort((left, right) => left.date.localeCompare(right.date));
};
