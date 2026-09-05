import type { AnalyticsPeriodKey, InsightSeverity, TrendDirection } from '../constants/analytics.js';

/**
 * The shapes analytics answers in.
 *
 * These types are the contract between the calculators, the agent tools and the
 * cards that draw them. They deliberately carry *structure* rather than prose:
 * a percentage is a number and a direction, not the sentence "up 11.7%". The
 * model turns them into language, the browser turns them into a card, and both
 * are reading the same arithmetic rather than each doing their own.
 *
 * Money is in integer minor units throughout, as everywhere else in Hadiya.
 */

/** A resolved window, as instants, plus how it was described. */
export interface AnalyticsPeriod {
  key: AnalyticsPeriodKey;
  /** `YYYY-MM-DD` in the actor's zone — the form Billz is queried with. */
  from: string;
  to: string;
  /** The zone the boundaries were resolved in. Never assumed to be UTC. */
  timezone: string;
  /** Whole days covered, inclusive, so two windows can be compared fairly. */
  days: number;
  /** A short human phrase: "this month", "1–14 September". */
  label: string;
}

/**
 * One figure measured against its own past.
 *
 * `percentageChange` is `null` rather than `Infinity` when there is no base to
 * grow from. Something appearing where there was nothing is a real event, but
 * it is not a percentage, and rendering "∞%" or "+100%" would both be lies of a
 * different kind. The direction still says what happened.
 */
export interface MetricComparison {
  metric: string;
  /** A word the card can title itself with. */
  label: string;
  current: number;
  previous: number;
  absoluteChange: number;
  /** Percent, e.g. `11.67`. `null` when the previous value was zero. */
  percentageChange: number | null;
  direction: TrendDirection;
  /** Whether the figures are money in minor units or a plain count. */
  money: boolean;
}

/** What moved a total, largest mover first. */
export interface AnalyticsContributor {
  /** Product, branch or category name as the source records it. */
  name: string;
  dimension: 'product' | 'branch' | 'category';
  current: number;
  previous: number;
  /** Signed: negative means this pulled the total down. */
  absoluteChange: number;
  percentageChange: number | null;
  /** Share of the total movement this one accounts for, 0–100. */
  shareOfChange: number | null;
}

/** One day's takings, for a baseline or a sparkline. */
export interface AnalyticsDailyPoint {
  /** `YYYY-MM-DD` in the actor's zone. */
  date: string;
  revenue: number;
  saleCount: number;
}

export interface AnalyticsTrend {
  metric: string;
  direction: TrendDirection;
  /** Percent change across the window, `null` when there is no base. */
  changePercent: number | null;
  /** How many days of evidence the call rests on. */
  observations: number;
  /** 0–1. Low means "worth mentioning", not "worth acting on". */
  confidence: number;
  series: AnalyticsDailyPoint[];
}

/**
 * A day that does not look like its neighbours.
 *
 * `deviationPercent` is measured against `baseline`, which is a plain median of
 * the comparison window — deliberately explainable arithmetic rather than a
 * model whose verdict nobody can check.
 */
export interface AnalyticsAnomaly {
  date: string;
  metric: string;
  value: number;
  baseline: number;
  deviationPercent: number;
  direction: 'spike' | 'drop';
  severity: InsightSeverity;
}

/**
 * A structured finding, before anybody puts it into a sentence.
 *
 * `evidence` is what the claim rests on, so the assistant can show its working
 * and a reader can disagree with it. `confidence` gates the language: a
 * low-confidence insight must be spoken as a possibility, never as a fact.
 */
export interface AnalyticsInsight {
  type: 'trend' | 'anomaly' | 'contributor' | 'comparison' | 'data_quality';
  metric: string;
  direction: TrendDirection;
  /** Signed percentage where one applies, else `null`. */
  magnitude: number | null;
  period: string;
  severity: InsightSeverity;
  /** Plain statements of fact, each independently checkable. */
  evidence: string[];
  confidence: number;
  /** A neutral headline. The model rewrites it in the person's language. */
  headline: string;
}

/**
 * Something worth considering, tied to the insight that prompted it.
 *
 * Never executed. Recommendations are read to the person, and any action that
 * follows goes through the ordinary confirmation path like any other write.
 */
export interface AnalyticsRecommendation {
  /** The insight this answers, by headline, so the pairing survives the trip. */
  basedOn: string;
  recommendation: string;
  /** Why this follows from the data, in one line. */
  rationale: string;
  priority: InsightSeverity;
  confidence: number;
}

/**
 * What the figures below could not account for.
 *
 * Present on every analytics answer, including the clean ones, so a caller
 * cannot mistake "nothing was wrong" for "nobody checked". An empty list is a
 * statement.
 */
export interface AnalyticsDataQuality {
  /** False when a cap or a gap means the figures are partial. */
  complete: boolean;
  notes: string[];
  /** Receipts the calculation actually saw. */
  recordsAnalysed: number;
  /** True when a bound stopped the fetch before the period was exhausted. */
  truncated: boolean;
}

export interface AnalyticsMetricSet {
  grossSales: number;
  netSales: number;
  returnsTotal: number;
  saleCount: number;
  returnCount: number;
  unitsSold: number;
  averageOrderValue: number;
  outstandingDebt: number;
}

export interface AnalyticsRanking {
  name: string;
  externalId: string | null;
  revenue: number;
  units: number;
  saleCount: number;
  /** Share of the period's net sales, 0–100. */
  shareOfRevenue: number | null;
}

/** The headline answer to "how are we doing?". */
export interface AnalyticsSummary {
  period: AnalyticsPeriod;
  metrics: AnalyticsMetricSet;
  /** Present only when a comparison period was asked for. */
  comparison: {
    period: AnalyticsPeriod;
    metrics: AnalyticsMetricSet;
    changes: MetricComparison[];
  } | null;
  daily: AnalyticsDailyPoint[];
  dataQuality: AnalyticsDataQuality;
  currency: string;
}

/** The executive summary: what changed, why it might have, what to look at. */
export interface AnalyticsInsightReport {
  period: AnalyticsPeriod;
  insights: AnalyticsInsight[];
  recommendations: AnalyticsRecommendation[];
  trends: AnalyticsTrend[];
  anomalies: AnalyticsAnomaly[];
  topContributors: AnalyticsContributor[];
  dataQuality: AnalyticsDataQuality;
}
