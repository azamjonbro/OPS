/**
 * The vocabulary business alerts speak in.
 *
 * Kept small on purpose. A list of forty alert types reads as thoroughness and
 * behaves as noise: every type is a thing that can fire wrongly, and a person
 * who has learned to dismiss alerts without reading them is worse off than one
 * who never had them. These are the changes a shopkeeper would want a phone
 * call about.
 */
export const ALERT_TYPES = [
  'REVENUE_DROP',
  'REVENUE_SPIKE',
  'SALES_DROP',
  'SALES_SPIKE',
  'BRANCH_DECLINE',
  'BRANCH_SPIKE',
  'PRODUCT_DEMAND_DROP',
  'PRODUCT_DEMAND_SPIKE',
  'LOW_STOCK',
  'DEBT_INCREASE',
  'EXPENSE_SPIKE',
  'ANOMALY',
  'TREND_CHANGE',
] as const;

export type AlertType = (typeof ALERT_TYPES)[number];

/**
 * How loud an alert is.
 *
 * `critical` is deliberately hard to reach. It is the only level allowed to
 * consider breaking quiet hours, and a system where everything is critical has
 * no way left to say that something actually is.
 */
export const ALERT_SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

/** Ordered, so "at least medium" is a comparison rather than a list of cases. */
export const ALERT_SEVERITY_RANK: Record<AlertSeverity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Where an alert is in its life.
 *
 * `resolved` is the one that earns its keep: a low-stock alert whose shelf has
 * been refilled should stop looking like an open problem without anybody having
 * to dismiss it by hand.
 */
export const ALERT_STATUSES = [
  'detected',
  'notified',
  'acknowledged',
  'resolved',
  'dismissed',
] as const;

export type AlertStatus = (typeof ALERT_STATUSES)[number];

/** Statuses a condition can still be re-detected into. */
export const ACTIVE_ALERT_STATUSES: readonly AlertStatus[] = [
  'detected',
  'notified',
  'acknowledged',
];

/** What an alert is measured over, which decides the evaluation cadence. */
export const ALERT_SCOPES = ['business', 'branch', 'product'] as const;

export type AlertScope = (typeof ALERT_SCOPES)[number];

/**
 * How long the same condition stays quiet after being reported.
 *
 * A day, because that is the granularity a shopkeeper acts on: being told at
 * 10:00 that today is slow is useful, and being told again at 11:00, 12:00 and
 * 13:00 is how somebody learns to ignore the badge entirely.
 */
export const ALERT_DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1_000;

/**
 * How much worse a condition must get to interrupt its own cooldown.
 *
 * Escalation exists so a deteriorating situation is not silenced by the quiet
 * period earned when it was mild — but a drop moving from -21% to -23% is the
 * same news, so a *severity* change is what re-opens the conversation, not any
 * movement at all.
 */
export const ALERT_ESCALATION_REQUIRES_SEVERITY_CHANGE = true;

/**
 * The rules Hadiya ships with.
 *
 * Every threshold here is deliberately conservative. The cost of a missed alert
 * is that somebody finds out at the end of the week; the cost of a false one,
 * repeated, is that the whole feature gets switched off. Retail is noisy enough
 * that a 10% swing means nothing, so nothing fires below 20%.
 */
export interface AlertRuleDefaults {
  type: AlertType;
  metric: string;
  scope: AlertScope;
  /**
   * Percent change that triggers it. Negative means "at or below", positive
   * means "at or above" — the sign carries the direction so a rule cannot be
   * configured to mean the opposite of its own name.
   */
  thresholdPercent: number;
  /** Days of data the comparison needs before the rule may fire at all. */
  minObservations: number;
  baseSeverity: AlertSeverity;
  cooldownMs: number;
  enabled: boolean;
}

export const DEFAULT_ALERT_RULES: readonly AlertRuleDefaults[] = [
  {
    type: 'REVENUE_DROP',
    metric: 'netSales',
    scope: 'business',
    thresholdPercent: -20,
    minObservations: 1,
    baseSeverity: 'medium',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    enabled: true,
  },
  {
    type: 'REVENUE_SPIKE',
    metric: 'netSales',
    scope: 'business',
    thresholdPercent: 30,
    minObservations: 1,
    baseSeverity: 'low',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    enabled: true,
  },
  {
    type: 'SALES_DROP',
    metric: 'saleCount',
    scope: 'business',
    thresholdPercent: -25,
    minObservations: 1,
    baseSeverity: 'low',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    enabled: true,
  },
  {
    type: 'BRANCH_DECLINE',
    metric: 'netSales',
    scope: 'branch',
    thresholdPercent: -20,
    minObservations: 1,
    baseSeverity: 'medium',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    enabled: true,
  },
  {
    type: 'LOW_STOCK',
    metric: 'quantity',
    scope: 'product',
    // Not a percentage: the threshold is a unit count, read from the rule's
    // own `thresholdUnits` below. Kept at zero here so nothing reads it as one.
    thresholdPercent: 0,
    minObservations: 0,
    baseSeverity: 'medium',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    enabled: true,
  },
  {
    type: 'ANOMALY',
    metric: 'revenue',
    scope: 'business',
    thresholdPercent: 0,
    // An anomaly needs a baseline; the analytics detector enforces its own
    // minimum, and this keeps the rule from firing on a shop's first week.
    minObservations: 5,
    baseSeverity: 'medium',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    enabled: true,
  },
  {
    type: 'DEBT_INCREASE',
    metric: 'outstandingDebt',
    scope: 'business',
    thresholdPercent: 50,
    minObservations: 1,
    baseSeverity: 'low',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    // Off by default: a shop that sells on credit routinely would be told so
    // every week, which is news to nobody who works there.
    enabled: false,
  },
  {
    type: 'PRODUCT_DEMAND_SPIKE',
    metric: 'units',
    scope: 'product',
    thresholdPercent: 100,
    minObservations: 1,
    baseSeverity: 'info',
    cooldownMs: ALERT_DEFAULT_COOLDOWN_MS,
    // Off by default: a catalogue of any size produces several of these a day.
    enabled: false,
  },
] as const;

/** Units at or below which stock counts as low. Not a percentage. */
export const LOW_STOCK_DEFAULT_UNITS = 3;

/** How many low-stock lines one evaluation will raise, so a restock day is not a flood. */
export const LOW_STOCK_MAX_ALERTS = 5;

/** How many branches one evaluation will raise. */
export const BRANCH_MAX_ALERTS = 5;

/**
 * Quiet hours, as a local wall clock.
 *
 * Stored as minutes past local midnight so a window can cross midnight without
 * needing two representations. Off by default: silencing somebody's alerts is
 * a choice they should make rather than one made for them.
 */
export interface QuietHours {
  enabled: boolean;
  /** Minutes past local midnight, 0–1439. */
  startMinute: number;
  endMinute: number;
  /**
   * Whether `critical` may still arrive during the window.
   *
   * Defaults to false, and the code never assumes otherwise: an alert that
   * wakes somebody at 03:00 because a threshold was crossed had better be
   * something they explicitly asked to be woken for.
   */
  allowCritical: boolean;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
  enabled: false,
  startMinute: 22 * 60,
  endMinute: 8 * 60,
  allowCritical: false,
};

/** Below this an alert is stored but never notified. */
export const DEFAULT_MIN_NOTIFY_SEVERITY: AlertSeverity = 'low';

/** Job types, named once so the scheduler and the module cannot disagree. */
export const ALERT_EVALUATION_JOB_TYPE = 'alerts.evaluate';

/** How often the business-wide rules are evaluated. */
export const ALERT_EVALUATION_INTERVAL_MS = 60 * 60 * 1_000;

/** How long a resolved or dismissed alert is kept, for answering "nega chiqdi?". */
export const ALERT_RETENTION_DAYS = 90;
