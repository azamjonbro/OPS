import {
  ALERT_SEVERITY_RANK,
  BRANCH_MAX_ALERTS,
  LOW_STOCK_MAX_ALERTS,
  type AlertEntity,
  type AlertEvidence,
  type AlertSeverity,
  type AlertType,
  type AnalyticsPeriod,
  type ResolvedAlertRule,
} from '@hadiya/shared';

/**
 * Deciding whether something is worth telling somebody about.
 *
 * Every function here is pure, synchronous and deterministic: given the same
 * figures it reaches the same verdict. That is a deliberate boundary — a model
 * is not asked whether -30% clears a -20% threshold, because that is
 * arithmetic, and a model that occasionally says no would produce an alerting
 * system nobody could reason about. The model's job starts afterwards, turning
 * a verdict into a sentence in the person's own language.
 *
 * Nothing here ever asserts a cause. A detector reports that a figure moved and
 * what it moved against; why it moved is not something these numbers know.
 */

export interface DetectionCandidate {
  type: AlertType;
  severity: AlertSeverity;
  entity: AlertEntity;
  title: string;
  summary: string;
  evidence: AlertEvidence;
}

/**
 * Whether a change clears a rule's threshold, in the rule's own direction.
 *
 * The sign of the threshold carries the direction, so a "drop" rule cannot be
 * configured into firing on a rise. A `null` change — growth from a zero base —
 * never fires: it is a real event, but it has no percentage, and comparing
 * `null` to a threshold would either throw or quietly pass.
 */
export const clearsThreshold = (
  changePercent: number | null,
  thresholdPercent: number,
): boolean => {
  if (changePercent === null || !Number.isFinite(changePercent)) {
    return false;
  }

  return thresholdPercent < 0
    ? changePercent <= thresholdPercent
    : changePercent >= thresholdPercent;
};

/**
 * How loud a crossing is, from how far past the line it went.
 *
 * Doubling the threshold raises the alert one level and tripling it raises it
 * two, capped at critical. Deliberately arithmetic rather than a table: a rule
 * whose threshold somebody has tuned should keep a proportionate severity
 * without anybody having to re-tune a second set of numbers to match.
 */
export const severityFor = (
  changePercent: number | null,
  rule: Pick<ResolvedAlertRule, 'thresholdPercent' | 'baseSeverity'>,
): AlertSeverity => {
  const base = rule.baseSeverity;

  if (changePercent === null || rule.thresholdPercent === 0) {
    return base;
  }

  const ratio = Math.abs(changePercent) / Math.abs(rule.thresholdPercent);
  const steps = ratio >= 2.5 ? 2 : ratio >= 1.75 ? 1 : 0;
  const order: AlertSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
  const raised = Math.min(ALERT_SEVERITY_RANK[base] + steps, order.length - 1);

  return order[raised] ?? base;
};

const percentText = (changePercent: number | null): string =>
  changePercent === null
    ? 'no comparable figure for the previous period'
    : `${changePercent > 0 ? '+' : ''}${changePercent}%`;

interface PeriodPair {
  period: AnalyticsPeriod;
  comparison: AnalyticsPeriod | null;
}

const evidenceFor = (options: {
  metric: string;
  currentValue: number;
  previousValue: number | null;
  changePercent: number | null;
  periods: PeriodPair;
  dataComplete: boolean;
  notes?: string[];
}): AlertEvidence => ({
  metric: options.metric,
  currentValue: options.currentValue,
  previousValue: options.previousValue,
  changePercent: options.changePercent,
  periodFrom: options.periods.period.from,
  periodTo: options.periods.period.to,
  comparisonFrom: options.periods.comparison?.from ?? null,
  comparisonTo: options.periods.comparison?.to ?? null,
  dataComplete: options.dataComplete,
  notes: options.notes ?? [],
});

/**
 * A business-wide metric measured against the previous window.
 *
 * `minObservations` is checked against the period's own length rather than
 * against how many receipts arrived: a rule that needs a week of evidence must
 * not be satisfied by a busy Tuesday.
 */
export const detectMetricChange = (options: {
  rule: ResolvedAlertRule;
  label: string;
  currentValue: number;
  previousValue: number;
  changePercent: number | null;
  periods: PeriodPair;
  dataComplete: boolean;
  formatValue: (value: number) => string;
}): DetectionCandidate | null => {
  const { rule, periods } = options;

  if (!rule.enabled || periods.period.days < rule.minObservations) {
    return null;
  }

  if (!clearsThreshold(options.changePercent, rule.thresholdPercent)) {
    return null;
  }

  const direction = rule.thresholdPercent < 0 ? 'down' : 'up';

  return {
    type: rule.type,
    severity: severityFor(options.changePercent, rule),
    entity: { kind: 'business', externalId: null, name: null },
    title: `${options.label} ${direction === 'down' ? 'is down' : 'is up'} ${percentText(options.changePercent)}`,
    // States the coincidence and stops. What moved the figure is a question for
    // the analytics tools the assistant can reach for, not a claim made here.
    summary: `${options.label} for ${periods.period.label} is ${options.formatValue(options.currentValue)}, against ${options.formatValue(options.previousValue)} for ${periods.comparison?.label ?? 'the previous period'} (${percentText(options.changePercent)}).`,
    evidence: evidenceFor({
      metric: rule.metric,
      currentValue: options.currentValue,
      previousValue: options.previousValue,
      changePercent: options.changePercent,
      periods,
      dataComplete: options.dataComplete,
    }),
  };
};

export interface BranchFigures {
  externalId: string | null;
  name: string;
  current: number;
  previous: number;
  changePercent: number | null;
}

/**
 * Branches whose takings moved past the rule's line.
 *
 * Capped, because a bad day is a bad day everywhere: a business with twelve
 * branches having a slow Monday should get one business-wide alert and at most
 * a handful of branch ones, not twelve notifications saying the same thing.
 * Worst first, so the cap keeps the ones that matter.
 */
export const detectBranchChanges = (options: {
  rule: ResolvedAlertRule;
  branches: BranchFigures[];
  periods: PeriodPair;
  dataComplete: boolean;
  formatValue: (value: number) => string;
  limit?: number;
}): DetectionCandidate[] => {
  const { rule, periods } = options;

  if (!rule.enabled || periods.period.days < rule.minObservations) {
    return [];
  }

  return options.branches
    .filter((branch) => clearsThreshold(branch.changePercent, rule.thresholdPercent))
    .sort((left, right) => Math.abs(right.changePercent ?? 0) - Math.abs(left.changePercent ?? 0))
    .slice(0, options.limit ?? BRANCH_MAX_ALERTS)
    .map((branch) => ({
      type: rule.type,
      severity: severityFor(branch.changePercent, rule),
      entity: { kind: 'branch' as const, externalId: branch.externalId, name: branch.name },
      title: `${branch.name}: revenue ${rule.thresholdPercent < 0 ? 'down' : 'up'} ${percentText(branch.changePercent)}`,
      summary: `${branch.name} took ${options.formatValue(branch.current)} in ${periods.period.label}, against ${options.formatValue(branch.previous)} in ${periods.comparison?.label ?? 'the previous period'} (${percentText(branch.changePercent)}).`,
      evidence: evidenceFor({
        metric: rule.metric,
        currentValue: branch.current,
        previousValue: branch.previous,
        changePercent: branch.changePercent,
        periods,
        dataComplete: options.dataComplete,
      }),
    }));
};

export interface StockLine {
  productExternalId: string;
  productName: string;
  /** Shown alongside the name, which is not unique in a real catalogue. */
  sku: string;
  shopName: string;
  quantity: number;
}

/**
 * Stock at or below the reorder line.
 *
 * A unit count, not a percentage: "three left" is what a shopkeeper acts on,
 * and a percentage of an unknown target stock level would be a number nobody
 * chose. Lines with nothing left at all are still reported — zero is the most
 * urgent case, not an absence of one.
 */
export const detectLowStock = (options: {
  rule: ResolvedAlertRule;
  lines: StockLine[];
  thresholdUnits: number;
  period: AnalyticsPeriod;
  limit?: number;
}): DetectionCandidate[] => {
  if (!options.rule.enabled) {
    return [];
  }

  return options.lines
    .filter((line) => line.quantity <= options.thresholdUnits)
    .sort((left, right) => left.quantity - right.quantity)
    .slice(0, options.limit ?? LOW_STOCK_MAX_ALERTS)
    .map((line) => {
      // A real catalogue has several variants sharing a display name — three
      // cards all reading "Alfajr wf14S is out of stock" look like a bug even
      // when every one of them is a different product. The SKU is what tells
      // them apart, so it travels in the title rather than being left in an id
      // nobody sees. Found by running this against a live Billz catalogue.
      const label = `${line.productName} (${line.sku})`;

      return {
        type: options.rule.type,
        // Nothing on the shelf is a step worse than nearly nothing on it.
        severity: line.quantity <= 0 ? ('high' as const) : options.rule.baseSeverity,
        entity: {
          kind: 'product' as const,
          externalId: line.productExternalId,
          name: label,
        },
        title:
          line.quantity <= 0 ? `${label} is out of stock` : `${label} is down to ${line.quantity}`,
        summary: `${label} has ${line.quantity} left at ${line.shopName}.`,
        evidence: evidenceFor({
          metric: 'quantity',
          currentValue: line.quantity,
          previousValue: null,
          changePercent: null,
          periods: { period: options.period, comparison: null },
          dataComplete: true,
          notes: [`Threshold: ${options.thresholdUnits} unit(s) or fewer.`, `At ${line.shopName}.`],
        }),
      };
    });
};

export interface AnomalyFigures {
  date: string;
  value: number;
  baseline: number;
  deviationPercent: number;
  direction: 'spike' | 'drop';
  severity: AlertSeverity;
}

/**
 * A day that did not look like its neighbours, as an alert.
 *
 * The analytics layer has already decided what counts as anomalous and capped
 * how many days it will name; this only turns that verdict into something a
 * person can be told, and never adds a reason for it.
 */
export const detectAnomalyAlerts = (options: {
  rule: ResolvedAlertRule;
  anomalies: AnomalyFigures[];
  period: AnalyticsPeriod;
  dataComplete: boolean;
  formatValue: (value: number) => string;
}): DetectionCandidate[] => {
  if (!options.rule.enabled || options.period.days < options.rule.minObservations) {
    return [];
  }

  return options.anomalies.map((anomaly) => ({
    type: options.rule.type,
    severity: anomaly.severity,
    entity: { kind: 'business' as const, externalId: null, name: null },
    title: `${anomaly.date} was an unusual day`,
    summary: `${anomaly.date} took ${options.formatValue(anomaly.value)}, ${Math.abs(anomaly.deviationPercent)}% ${anomaly.direction === 'spike' ? 'above' : 'below'} the ${options.formatValue(anomaly.baseline)} median of the other days in ${options.period.label}.`,
    evidence: evidenceFor({
      metric: 'revenue',
      currentValue: anomaly.value,
      previousValue: anomaly.baseline,
      changePercent: anomaly.deviationPercent,
      periods: { period: options.period, comparison: null },
      dataComplete: options.dataComplete,
      notes: ['The baseline is the median of the other days in the period.'],
    }),
  }));
};
