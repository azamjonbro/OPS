import type {
  AlertScope,
  AlertSeverity,
  AlertStatus,
  AlertType,
  QuietHours,
} from '../constants/alerts.js';
import type { Entity } from './entity.js';

/**
 * What a detected alert carries.
 *
 * The evidence is the important half. An alert that says "revenue is down" and
 * cannot say what it was measured against is one nobody can check, argue with,
 * or act on — and the first time it is wrong it costs the feature its
 * credibility. So every alert stores the figures it was raised from.
 *
 * Money is in integer minor units, as everywhere else.
 */
export interface AlertEvidence {
  metric: string;
  currentValue: number;
  previousValue: number | null;
  /** `null` where there was no base to compare against, never `Infinity`. */
  changePercent: number | null;
  /** `YYYY-MM-DD` bounds, in the owner's timezone. */
  periodFrom: string;
  periodTo: string;
  comparisonFrom: string | null;
  comparisonTo: string | null;
  /** Whether the figures behind this were complete. */
  dataComplete: boolean;
  /** Plain, individually checkable statements. Never a causal claim. */
  notes: string[];
}

/** The thing an alert is about, when it is about one thing in particular. */
export interface AlertEntity {
  kind: AlertScope;
  /** Billz id where there is one; a branch or product. */
  externalId: string | null;
  name: string | null;
}

export interface BusinessAlert extends Entity {
  user: string;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  scope: AlertScope;
  entity: AlertEntity;
  title: string;
  /** One sentence, already written for a person. */
  summary: string;
  evidence: AlertEvidence;
  /**
   * Identity of the *condition*, not of this sighting.
   *
   * Two evaluations of the same condition produce the same fingerprint, which
   * is what makes suppression possible. Severity is deliberately not part of
   * it: a worsening condition is the same condition, escalated, rather than a
   * second alert competing with the first.
   */
  fingerprint: string;
  /** How many times this condition has been seen since it opened. */
  occurrences: number;
  detectedAt: string;
  lastSeenAt: string;
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  dismissedAt: string | null;
  /** Notification this produced, for navigating from the inbox to the alert. */
  notificationId: string | null;
}

/**
 * What a person has chosen to hear about.
 *
 * One document per account rather than a row per rule: the whole preference set
 * is read on every evaluation, and a shopkeeper adjusting alerts is adjusting a
 * handful of switches, not administering a policy engine.
 */
export interface AlertPreference extends Entity {
  user: string;
  /** Types explicitly switched off. Anything absent uses the shipped default. */
  disabledTypes: AlertType[];
  /** Alerts below this are recorded but never notified. */
  minSeverity: AlertSeverity;
  quietHours: QuietHours;
}

/** The counts a badge and a filter bar need, without pulling the list. */
export interface AlertSummary {
  active: number;
  unacknowledged: number;
  bySeverity: Record<AlertSeverity, number>;
}

/** One rule as it is actually applied, after preferences are folded in. */
export interface ResolvedAlertRule {
  type: AlertType;
  metric: string;
  scope: AlertScope;
  thresholdPercent: number;
  minObservations: number;
  baseSeverity: AlertSeverity;
  cooldownMs: number;
  enabled: boolean;
}
