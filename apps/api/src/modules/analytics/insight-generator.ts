import {
  ANALYTICS_CONFIDENT_THRESHOLD,
  formatMoney,
  type AnalyticsAnomaly,
  type AnalyticsContributor,
  type AnalyticsDataQuality,
  type AnalyticsInsight,
  type AnalyticsPeriod,
  type AnalyticsRecommendation,
  type AnalyticsTrend,
  type InsightSeverity,
  type MetricComparison,
} from '@hadiya/shared';

/**
 * Turning figures into findings — and no further.
 *
 * An insight here is still structured: a direction, a magnitude, a list of
 * things that are individually checkable, and a confidence. The sentence a
 * person reads is written by the model afterwards, in their own language. That
 * split is the point. Prose generated here would be English, would ignore the
 * conversation, and would be one more place for a number to be restated
 * slightly wrong.
 *
 * The rule this file exists to enforce is the causation rule. Nothing below
 * ever says *why* something happened. Two facts that moved together are
 * reported as having moved together — "coincides with", never "because of" —
 * and the evidence list is what lets a reader draw their own conclusion.
 */

const money = (minor: number): string => formatMoney(minor);

const severityForChange = (percent: number | null): InsightSeverity => {
  if (percent === null) {
    return 'info';
  }

  const magnitude = Math.abs(percent);

  if (magnitude >= 30) {
    return 'high';
  }

  if (magnitude >= 15) {
    return 'medium';
  }

  return magnitude >= 5 ? 'low' : 'info';
};

/** A movement worth putting in front of somebody, as a structured finding. */
export const insightFromComparison = (
  comparison: MetricComparison,
  period: AnalyticsPeriod,
): AnalyticsInsight => {
  const evidence = [
    `${comparison.label} for ${period.label}: ${comparison.money ? money(comparison.current) : comparison.current}.`,
    `Previous period: ${comparison.money ? money(comparison.previous) : comparison.previous}.`,
    comparison.percentageChange === null
      ? // Said plainly rather than dressed up as a percentage. The previous
        // period had nothing to grow from, and any figure here would be made up.
        // Worded without a causal conjunction on purpose: the word "because"
        // appears nowhere in generated analytics text, which lets a test assert
        // the causation rule mechanically rather than by review.
        'There is no percentage change: the previous period was zero.'
      : `Change: ${comparison.percentageChange > 0 ? '+' : ''}${comparison.percentageChange}%.`,
  ];

  return {
    type: 'comparison',
    metric: comparison.metric,
    direction: comparison.direction,
    magnitude: comparison.percentageChange,
    period: period.label,
    severity: severityForChange(comparison.percentageChange),
    evidence,
    // A comparison of two figures we hold is as certain as analytics gets: the
    // arithmetic is not in doubt, only its interpretation is.
    confidence: comparison.percentageChange === null ? 0.5 : 0.95,
    headline: `${comparison.label} ${comparison.direction === 'flat' ? 'held steady' : comparison.direction} for ${period.label}`,
  };
};

export const insightFromTrend = (
  trend: AnalyticsTrend,
  period: AnalyticsPeriod,
): AnalyticsInsight | null => {
  if (trend.direction === 'flat' || trend.confidence < 0.4) {
    // Nothing happened, or too little evidence to say it did. Both are silence
    // rather than a low-severity finding nobody needed to read.
    return null;
  }

  return {
    type: 'trend',
    metric: trend.metric,
    direction: trend.direction,
    magnitude: trend.changePercent,
    period: period.label,
    severity: severityForChange(trend.changePercent),
    evidence: [
      `Measured across ${trend.observations} day(s) in ${period.label}.`,
      `The later half of the period is ${trend.changePercent ?? 0}% ${trend.direction === 'up' ? 'above' : 'below'} the earlier half, comparing medians.`,
    ],
    confidence: trend.confidence,
    headline: `${trend.metric} is trending ${trend.direction} over ${period.label}`,
  };
};

export const insightFromAnomaly = (
  anomaly: AnalyticsAnomaly,
  period: AnalyticsPeriod,
): AnalyticsInsight => ({
  type: 'anomaly',
  metric: anomaly.metric,
  direction: anomaly.direction === 'spike' ? 'up' : 'down',
  magnitude: anomaly.deviationPercent,
  period: period.label,
  severity: anomaly.severity,
  evidence: [
    `${anomaly.date} recorded ${money(anomaly.value)}.`,
    `The median of the other days in the period is ${money(anomaly.baseline)}.`,
    `That is ${Math.abs(anomaly.deviationPercent)}% ${anomaly.direction === 'spike' ? 'above' : 'below'} the baseline.`,
  ],
  // Deliberately not certainty. The arithmetic is sound, but "unusual" is a
  // judgement about a threshold somebody chose, not a fact about the shop.
  confidence: 0.75,
  headline: `${anomaly.date} was an unusual day (${anomaly.direction})`,
});

/**
 * What moved the total, as a finding.
 *
 * The wording is chosen with care: a contributor "accounts for" part of a
 * change. It does not explain it. A product falling 45m tells you where the
 * arithmetic went, not why anybody stopped buying it.
 */
export const insightFromContributors = (
  contributors: AnalyticsContributor[],
  period: AnalyticsPeriod,
): AnalyticsInsight | null => {
  if (contributors.length === 0) {
    return null;
  }

  const leader = contributors[0];

  if (!leader) {
    return null;
  }

  return {
    type: 'contributor',
    metric: 'revenue',
    direction: leader.absoluteChange > 0 ? 'up' : 'down',
    magnitude: leader.percentageChange,
    period: period.label,
    severity: severityForChange(leader.percentageChange),
    evidence: contributors.map(
      (contributor) =>
        `${contributor.name} (${contributor.dimension}): ${contributor.absoluteChange > 0 ? '+' : ''}${money(contributor.absoluteChange)}${
          contributor.shareOfChange === null
            ? ''
            : `, ${contributor.shareOfChange}% of the total movement`
        }.`,
    ),
    confidence: 0.9,
    headline: `${leader.name} accounts for the largest part of the change in ${period.label}`,
  };
};

/** A data gap is itself a finding, so an answer can never quietly omit one. */
export const insightFromDataQuality = (
  quality: AnalyticsDataQuality,
  period: AnalyticsPeriod,
): AnalyticsInsight | null => {
  if (quality.complete) {
    return null;
  }

  return {
    type: 'data_quality',
    metric: 'coverage',
    direction: 'flat',
    magnitude: null,
    period: period.label,
    severity: quality.truncated ? 'medium' : 'low',
    evidence: quality.notes,
    confidence: 1,
    headline: 'These figures are based on incomplete data',
  };
};

/**
 * Suggestions, tied to the finding that produced them.
 *
 * Every recommendation here is a *thing to look at*, never a thing to do
 * automatically — nothing in this module can change a price, run a campaign or
 * touch stock, and any action that follows goes through the ordinary
 * confirmation path like every other write in Hadiya.
 *
 * They are also only generated for findings that clear the confidence bar. A
 * suggestion built on a maybe is worse than no suggestion, because it reads
 * with exactly the same authority as one built on a certainty.
 */
export const buildRecommendations = (insights: AnalyticsInsight[]): AnalyticsRecommendation[] => {
  const recommendations: AnalyticsRecommendation[] = [];
  // A period where several days each look unusual would otherwise produce the
  // same sentence once per day. Ten identical suggestions are not ten times the
  // advice; they are noise that buries the one thing worth reading.
  const seen = new Set<string>();

  const add = (recommendation: AnalyticsRecommendation): void => {
    if (seen.has(recommendation.recommendation)) {
      return;
    }

    seen.add(recommendation.recommendation);
    recommendations.push(recommendation);
  };

  for (const insight of insights) {
    if (insight.confidence < ANALYTICS_CONFIDENT_THRESHOLD) {
      continue;
    }

    if (insight.type === 'data_quality') {
      add({
        basedOn: insight.headline,
        recommendation:
          'Treat these figures as provisional and narrow the period before acting on them.',
        rationale: insight.evidence.join(' '),
        priority: insight.severity,
        confidence: insight.confidence,
      });
      continue;
    }

    if (insight.direction === 'down' && insight.severity !== 'info') {
      add({
        basedOn: insight.headline,
        recommendation:
          insight.type === 'contributor'
            ? 'Look at the largest fallers first: check their stock, price and shelf position before anything else.'
            : 'Review what changed over this period — stock availability, pricing and opening hours are the usual places to start.',
        rationale: insight.evidence[0] ?? insight.headline,
        priority: insight.severity,
        confidence: insight.confidence,
      });
      continue;
    }

    if (
      insight.direction === 'up' &&
      (insight.severity === 'high' || insight.severity === 'medium')
    ) {
      add({
        basedOn: insight.headline,
        recommendation:
          'Check that stock can sustain the increase, so the growth is not lost to an empty shelf.',
        rationale: insight.evidence[0] ?? insight.headline,
        priority: insight.severity === 'high' ? 'medium' : 'low',
        confidence: insight.confidence,
      });
    }
  }

  return recommendations;
};

/**
 * Orders findings so the most important is read first.
 *
 * Severity, then confidence. An uncertain crisis still outranks a certain
 * triviality, because the first is worth a look and the second is not.
 */
const SEVERITY_ORDER: Record<InsightSeverity, number> = { high: 0, medium: 1, low: 2, info: 3 };

export const prioritiseInsights = (insights: AnalyticsInsight[]): AnalyticsInsight[] =>
  [...insights].sort((left, right) => {
    const bySeverity = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];

    return bySeverity !== 0 ? bySeverity : right.confidence - left.confidence;
  });
