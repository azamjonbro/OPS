/**
 * The vocabulary analytics is allowed to speak in.
 *
 * Named here rather than in the API module because the browser draws these
 * words — a severity decides a card's colour, a direction decides an arrow —
 * and a client inventing its own list is how a card silently stops matching
 * what the server meant.
 */

/**
 * Windows a person actually asks for.
 *
 * "This week" is Monday-based, matching the ISO week the rest of Hadiya already
 * uses for recurrence. `custom` carries its own dates.
 */
export const ANALYTICS_PERIODS = [
  'today',
  'yesterday',
  'this_week',
  'last_week',
  'this_month',
  'last_month',
  'this_quarter',
  'last_quarter',
  'this_year',
  'last_year',
  'custom',
] as const;

export type AnalyticsPeriodKey = (typeof ANALYTICS_PERIODS)[number];

export const TREND_DIRECTIONS = ['up', 'down', 'flat'] as const;

export type TrendDirection = (typeof TREND_DIRECTIONS)[number];

export const INSIGHT_SEVERITIES = ['info', 'low', 'medium', 'high'] as const;

export type InsightSeverity = (typeof INSIGHT_SEVERITIES)[number];

/**
 * How much movement counts as a trend rather than as an ordinary week.
 *
 * Retail is noisy: a shop can take a fifth more on a Saturday than a Tuesday
 * without anything having changed. Calling that a trend teaches people to
 * ignore the assistant, which is worse than saying nothing. So a direction is
 * only claimed past this much movement, and only with enough days behind it.
 *
 * Configurable through the analytics config so a quieter business can lower it.
 */
export const ANALYTICS_THRESHOLDS = {
  /** Percent change below which a period is reported as flat. */
  trendPercent: 10,
  /** Days of history a trend claim needs before it is made at all. */
  minTrendObservations: 4,
  /** How far from the median a day must sit to be called anomalous, in percent. */
  anomalyPercent: 40,
  /** Days of baseline an anomaly call needs. Fewer, and there is no baseline. */
  minAnomalyObservations: 5,
  /** Movement below this share of the total is not worth naming as a cause. */
  contributorSharePercent: 5,
} as const;

/**
 * Confidence below which a finding must be spoken as a possibility.
 *
 * The agent's instructions reference this: above it, "savdo 18% kamaydi"; below
 * it, "kamayish ... bilan bog'liq bo'lishi mumkin". It exists so that hedging
 * is a property of the data rather than of how the model happens to feel.
 */
export const ANALYTICS_CONFIDENT_THRESHOLD = 0.7;

/**
 * The most receipts one analytics question will read.
 *
 * A ceiling rather than a target. Past it the answer is still returned, but it
 * is marked incomplete — an analysis that quietly saw half a month is far worse
 * than one that says it did.
 */
export const ANALYTICS_MAX_RECEIPTS = 5_000;

/**
 * The longest window a custom period may span.
 *
 * Two years and a day, which covers the longest question anybody actually asks
 * — this year against last year — with room for a leap day.
 *
 * It is a limit rather than a preference because the `from` and `to` of a
 * custom period are written by the *model*, and the model reads uploaded
 * documents and other people's servers. `from: 0001-01-01, to: 9999-12-31`
 * resolves to three and a half million days, and the report builds one entry
 * per day: hundreds of megabytes and a second of blocked event loop, per call,
 * from one argument. A shopkeeper asking for a decade of daily takings has
 * asked the wrong question anyway.
 */
export const ANALYTICS_MAX_PERIOD_DAYS = 731;

/** How many rows a ranking returns before it stops being a ranking. */
export const ANALYTICS_MAX_RANKING = 20;

/**
 * How many unusual days one report will name.
 *
 * A period that steps from one level to another makes *every* day look unusual
 * against the median of the others — mathematically true and completely
 * useless, because a report that lists ten anomalies out of ten days has not
 * found anything. Only the most extreme are named, and the rest are left to
 * the trend, which is the finding that period actually contains.
 */
export const ANALYTICS_MAX_ANOMALIES = 5;

/** How long a computed answer may be reused. Short: shops ask about today. */
export const ANALYTICS_CACHE_TTL_MS = 120_000;
