import {
  LOW_STOCK_DEFAULT_UNITS,
  formatMoney,
  type AlertType,
  type AuthenticatedUser,
} from '@hadiya/shared';

import { createLogger } from '../../core/logger/logger.js';
import type { AnalyticsDependencies } from '../analytics/analytics.service.js';
import {
  getAnomalies,
  getBranchPerformance,
  getInventoryAnalysis,
  getSummary,
} from '../analytics/analytics.service.js';
import { percentageChange, roundPercent } from '../analytics/metric-calculator.js';
import { previousPeriod, resolvePeriod } from '../analytics/period.js';
import {
  fingerprintFor,
  notifyAlert,
  recordDetection,
  resolveMissing,
  resolveRules,
} from './alert.service.js';
import {
  detectAnomalyAlerts,
  detectBranchChanges,
  detectLowStock,
  detectMetricChange,
  type DetectionCandidate,
} from './detector.js';

const log = createLogger('alert-evaluator');

/**
 * One pass of "is anything worth mentioning?".
 *
 * Every figure here comes from the Phase 14 analytics services — no revenue is
 * recalculated, and no Billz endpoint is touched directly. That matters for
 * more than tidiness: analytics already caches a window per account, so the
 * five rules below share two Billz reads rather than making five, and the
 * figures in an alert are guaranteed to agree with the figures the assistant
 * quotes when asked about the same period.
 */

const money = (minor: number): string => formatMoney(minor);
const plain = (value: number): string => String(value);

/**
 * The same arithmetic analytics uses, deliberately imported rather than
 * rewritten. An alert that disagreed with the figure the assistant quotes for
 * the same period would be worse than no alert at all — and two
 * implementations of "percentage change" will always eventually disagree,
 * particularly about the zero-base case.
 */
const changePercentOf = (current: number, previous: number): number | null =>
  roundPercent(percentageChange(current, previous));

export interface EvaluationResult {
  evaluated: number;
  created: number;
  escalated: number;
  suppressed: number;
  notified: number;
  resolved: number;
  /** Set when the data was partial; recorded rather than acted on. */
  incomplete: boolean;
}

const EMPTY: EvaluationResult = {
  evaluated: 0,
  created: 0,
  escalated: 0,
  suppressed: 0,
  notified: 0,
  resolved: 0,
  incomplete: false,
};

/**
 * Evaluates every enabled rule for one account.
 *
 * The period is today measured against yesterday, in the account's own
 * timezone. That is the cadence a shop actually reacts on, and it is the
 * comparison a person means by "bugun qanday ketyapti".
 *
 * A Billz failure propagates rather than being swallowed: the scheduler turns
 * it into a retry with backoff, and no alert is invented from data that never
 * arrived. Reporting a cheerful "nothing to report" when the shop's figures
 * were unreachable would be the worst possible failure mode for this feature.
 */
export const evaluateForActor = async (
  actor: AuthenticatedUser,
  now: Date = new Date(),
  dependencies: AnalyticsDependencies = {},
): Promise<EvaluationResult> => {
  const rules = await resolveRules(actor);
  const enabled = rules.filter((rule) => rule.enabled);

  if (enabled.length === 0) {
    return { ...EMPTY };
  }

  const period = resolvePeriod({ key: 'today', timezone: actor.timezone, now });
  const comparison = previousPeriod(period);
  const ruleFor = (type: AlertType) => enabled.find((rule) => rule.type === type);

  const candidates: Array<{ candidate: DetectionCandidate; cooldownMs: number }> = [];
  let incomplete = false;

  // One summary read covers every business-wide rule; analytics caches the
  // window, so the branch and anomaly reads below reuse it rather than paying
  // for it again.
  const summary = await getSummary(actor, period, { compare: true }, dependencies);

  incomplete = incomplete || !summary.dataQuality.complete;

  const change = (metric: 'netSales' | 'saleCount' | 'outstandingDebt') => {
    const current = summary.metrics[metric];
    const previous = summary.comparison?.metrics[metric] ?? 0;

    return {
      current,
      previous,
      changePercent: changePercentOf(current, previous),
    };
  };

  for (const [type, metric, label, format] of [
    ['REVENUE_DROP', 'netSales', 'Revenue', money],
    ['REVENUE_SPIKE', 'netSales', 'Revenue', money],
    ['SALES_DROP', 'saleCount', 'Sales', plain],
    ['SALES_SPIKE', 'saleCount', 'Sales', plain],
    ['DEBT_INCREASE', 'outstandingDebt', 'Outstanding debt', money],
  ] as const) {
    const rule = ruleFor(type);

    if (!rule) {
      continue;
    }

    const figures = change(metric);
    const candidate = detectMetricChange({
      rule,
      label,
      currentValue: figures.current,
      previousValue: figures.previous,
      changePercent: figures.changePercent,
      periods: { period, comparison },
      dataComplete: summary.dataQuality.complete,
      formatValue: format,
    });

    if (candidate) {
      candidates.push({ candidate, cooldownMs: rule.cooldownMs });
    }
  }

  const branchRule = ruleFor('BRANCH_DECLINE') ?? ruleFor('BRANCH_SPIKE');

  if (branchRule) {
    const [current, previous] = await Promise.all([
      getBranchPerformance(actor, period, dependencies),
      getBranchPerformance(actor, comparison, dependencies),
    ]);

    const previousByName = new Map(previous.items.map((row) => [row.name, row.revenue]));

    // A single-branch business is already fully described by the business-wide
    // rules above: "revenue is down 60%" and "Chilonzor is down 60%" are the
    // same sentence twice, and sending both is how a person learns that half
    // their alerts are redundant. Branch alerts only say something new once
    // there is more than one branch to distinguish between.
    const branches = current.items.length > 1 ? current.items : [];

    for (const candidate of detectBranchChanges({
      rule: branchRule,
      branches: branches.map((row) => {
        const before = previousByName.get(row.name) ?? 0;

        return {
          externalId: row.externalId,
          name: row.name,
          current: row.revenue,
          previous: before,
          changePercent: changePercentOf(row.revenue, before),
        };
      }),
      periods: { period, comparison },
      dataComplete: current.dataQuality.complete,
      formatValue: money,
    })) {
      candidates.push({ candidate, cooldownMs: branchRule.cooldownMs });
    }
  }

  const stockRule = ruleFor('LOW_STOCK');

  if (stockRule) {
    const inventory = await getInventoryAnalysis(
      actor,
      period,
      { lowStockThreshold: LOW_STOCK_DEFAULT_UNITS, limit: 50 },
      dependencies,
    );

    for (const candidate of detectLowStock({
      rule: stockRule,
      lines: inventory.lowStock.map((row) => ({
        // Stock rows are keyed by name and shop; the analysis does not carry
        // the Billz product id, so the name is what identifies the condition.
        productExternalId: `${row.sku}@${row.shopName}`,
        productName: row.productName,
        sku: row.sku,
        shopName: row.shopName,
        quantity: row.quantity,
      })),
      thresholdUnits: LOW_STOCK_DEFAULT_UNITS,
      period,
    })) {
      candidates.push({ candidate, cooldownMs: stockRule.cooldownMs });
    }
  }

  const anomalyRule = ruleFor('ANOMALY');

  if (anomalyRule) {
    // Anomalies need a baseline, so they are measured over a window rather than
    // over today alone — a single day has nothing to be unusual against.
    const window = resolvePeriod({ key: 'this_month', timezone: actor.timezone, now });
    const anomalies = await getAnomalies(actor, window, dependencies);

    incomplete = incomplete || !anomalies.dataQuality.complete;

    for (const candidate of detectAnomalyAlerts({
      rule: anomalyRule,
      anomalies: anomalies.anomalies.map((entry) => ({
        date: entry.date,
        value: entry.value,
        baseline: entry.baseline,
        deviationPercent: entry.deviationPercent,
        direction: entry.direction,
        severity: entry.severity === 'info' ? 'low' : entry.severity,
      })),
      period: window,
      dataComplete: anomalies.dataQuality.complete,
      formatValue: money,
    })) {
      candidates.push({ candidate, cooldownMs: anomalyRule.cooldownMs });
    }
  }

  const result: EvaluationResult = { ...EMPTY, evaluated: candidates.length, incomplete };
  const raised: string[] = [];

  for (const { candidate, cooldownMs } of candidates) {
    const outcome = await recordDetection(actor, candidate, { cooldownMs }, now);

    raised.push(outcome.alert.fingerprint);

    if (outcome.action === 'created') {
      result.created += 1;
    } else if (outcome.action === 'escalated') {
      result.escalated += 1;
    } else if (outcome.action === 'suppressed') {
      result.suppressed += 1;
    }

    // Suppression is the whole point of the cooldown: the condition is recorded
    // either way, and only a new or materially worse one reaches the person.
    if (outcome.action === 'suppressed') {
      continue;
    }

    const { notified } = await notifyAlert(actor, outcome.alert, now);

    if (notified) {
      result.notified += 1;
    }
  }

  // Anything open of a type this pass evaluated, that this pass did not raise,
  // has stopped being true.
  result.resolved = await resolveMissing(
    actor,
    enabled.map((rule) => rule.type),
    raised,
    now,
  );

  log.info(
    {
      userId: actor.id,
      period: period.label,
      ...result,
    },
    'alert evaluation completed',
  );

  return result;
};

/** Exposed so a test can assert a fingerprint without reimplementing it. */
export { fingerprintFor };
