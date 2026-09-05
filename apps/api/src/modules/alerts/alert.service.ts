import { createHash } from 'node:crypto';

import {
  ACTIVE_ALERT_STATUSES,
  ALERT_SEVERITY_RANK,
  DEFAULT_ALERT_RULES,
  buildPaginationMeta,
  resolvePagination,
  toZonedParts,
  type AlertSeverity,
  type AlertStatus,
  type AlertSummary,
  type AlertType,
  type AuthenticatedUser,
  type PaginatedResult,
  type QuietHours,
  type ResolvedAlertRule,
} from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { deliver } from '../notifications/notification.service.js';
import { AlertModel, AlertPreferenceModel, type AlertDocument } from './alert.model.js';
import type { DetectionCandidate } from './detector.js';

const log = createLogger('alerts');

/**
 * The lifecycle of an alert, and the rules that stop it becoming spam.
 *
 * Everything about *whether* to tell somebody lives here; everything about
 * *what* is happening lives in the detector. The split matters because the
 * suppression rules are where an alerting system is actually won or lost — a
 * detector that is right every hour and a delivery layer that says so every
 * hour add up to a feature people switch off.
 *
 * Every query filters on the actor's id. That filter is the authorisation: a
 * query that cannot match another account's row cannot leak one.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

/**
 * The identity of a condition.
 *
 * Type, entity and the period it was measured over — and deliberately *not*
 * severity or the figures themselves. A drop that deepens from -21% to -34% is
 * the same condition getting worse, which is an escalation; treating it as a
 * new condition would produce two open alerts about one problem.
 *
 * The account is hashed in as well, so a fingerprint from one account can never
 * collide with another's even if the conditions are identical.
 */
export const fingerprintFor = (options: {
  userId: string;
  type: AlertType;
  entityExternalId: string | null;
  periodFrom: string;
  periodTo: string;
}): string =>
  createHash('sha256')
    .update(
      [
        options.userId,
        options.type,
        options.entityExternalId ?? 'business',
        options.periodFrom,
        options.periodTo,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 40);

/** Preferences, with the shipped defaults standing in for anything unset. */
export const getPreferences = async (actor: AuthenticatedUser) => {
  const stored = await AlertPreferenceModel.findOne(ownedBy(actor)).lean().exec();

  return {
    disabledTypes: stored?.disabledTypes ?? [],
    minSeverity: stored?.minSeverity ?? 'low',
    quietHours: stored?.quietHours ?? {
      enabled: false,
      startMinute: 22 * 60,
      endMinute: 8 * 60,
      allowCritical: false,
    },
  };
};

export const updatePreferences = async (
  actor: AuthenticatedUser,
  input: {
    disabledTypes?: AlertType[];
    minSeverity?: AlertSeverity;
    quietHours?: QuietHours;
  },
) => {
  const update: Record<string, unknown> = {};

  if (input.disabledTypes) {
    update.disabledTypes = input.disabledTypes;
  }

  if (input.minSeverity) {
    update.minSeverity = input.minSeverity;
  }

  if (input.quietHours) {
    update.quietHours = input.quietHours;
  }

  await AlertPreferenceModel.updateOne(ownedBy(actor), { $set: update }, { upsert: true }).exec();

  return getPreferences(actor);
};

/** The shipped rules with this account's switches applied. */
export const resolveRules = async (actor: AuthenticatedUser): Promise<ResolvedAlertRule[]> => {
  const preferences = await getPreferences(actor);
  const disabled = new Set<AlertType>(preferences.disabledTypes);

  return DEFAULT_ALERT_RULES.map((rule) => ({
    type: rule.type,
    metric: rule.metric,
    scope: rule.scope,
    thresholdPercent: rule.thresholdPercent,
    minObservations: rule.minObservations,
    baseSeverity: rule.baseSeverity,
    cooldownMs: rule.cooldownMs,
    enabled: rule.enabled && !disabled.has(rule.type),
  }));
};

/**
 * Whether the local wall clock is inside the quiet window.
 *
 * Read in the account's own timezone, and written to handle a window that
 * crosses midnight — 22:00 to 08:00 is the normal case, and treating it as a
 * simple range would make it match nothing at all.
 */
export const isWithinQuietHours = (
  quietHours: QuietHours,
  timezone: string,
  now: Date,
): boolean => {
  if (!quietHours.enabled) {
    return false;
  }

  const { hour, minute } = toZonedParts(now, timezone);
  const current = hour * 60 + minute;
  const { startMinute, endMinute } = quietHours;

  return startMinute <= endMinute
    ? current >= startMinute && current < endMinute
    : current >= startMinute || current < endMinute;
};

export interface RecordOutcome {
  alert: AlertDocument;
  /** What the evaluation actually did, which is what the anti-spam tests assert. */
  action: 'created' | 'escalated' | 'suppressed' | 'renotified';
  notified: boolean;
}

const isMoreSevere = (next: AlertSeverity, current: AlertSeverity): boolean =>
  ALERT_SEVERITY_RANK[next] > ALERT_SEVERITY_RANK[current];

/**
 * Records one detected condition, deciding whether anybody hears about it.
 *
 * The four outcomes are the whole anti-spam policy:
 *
 *  - **created** — nothing open matched this fingerprint. Notify.
 *  - **escalated** — the condition is open and has got materially worse, i.e.
 *    crossed into a higher severity. Notify again, because "it is worse now" is
 *    genuinely new information even inside a cooldown.
 *  - **renotified** — still true, and the cooldown has expired. Notify.
 *  - **suppressed** — still true, unchanged, inside the cooldown. Say nothing,
 *    but record the sighting so "how long has this been going on" is answerable.
 *
 * Ten evaluations of an unchanged condition therefore produce one notification
 * and nine suppressions, which is the behaviour the phase exists to guarantee.
 */
export const recordDetection = async (
  actor: AuthenticatedUser,
  candidate: DetectionCandidate,
  rule: Pick<ResolvedAlertRule, 'cooldownMs'>,
  now: Date,
): Promise<RecordOutcome> => {
  const fingerprint = fingerprintFor({
    userId: actor.id,
    type: candidate.type,
    entityExternalId: candidate.entity.externalId,
    periodFrom: candidate.evidence.periodFrom,
    periodTo: candidate.evidence.periodTo,
  });

  const existing = await AlertModel.findOne(
    ownedBy(actor, { fingerprint, status: { $in: ACTIVE_ALERT_STATUSES } }),
  )
    .lean<AlertDocument | null>()
    .exec();

  if (!existing) {
    try {
      const created = await AlertModel.create({
        user: toObjectId(actor.id),
        type: candidate.type,
        severity: candidate.severity,
        status: 'detected',
        scope: candidate.entity.kind,
        entityKind: candidate.entity.kind,
        entityExternalId: candidate.entity.externalId,
        entityName: candidate.entity.name,
        title: candidate.title,
        summary: candidate.summary,
        evidence: candidate.evidence,
        fingerprint,
        occurrences: 1,
        detectedAt: now,
        lastSeenAt: now,
      });

      return { alert: created.toObject<AlertDocument>(), action: 'created', notified: false };
    } catch (error) {
      // Two evaluations raced and the unique index settled it. The loser reads
      // the winner's row and treats this as a repeat sighting rather than
      // failing — which is exactly what it is.
      const raced = await AlertModel.findOne(
        ownedBy(actor, { fingerprint, status: { $in: ACTIVE_ALERT_STATUSES } }),
      )
        .lean<AlertDocument | null>()
        .exec();

      if (!raced) {
        throw error;
      }

      return { alert: raced, action: 'suppressed', notified: false };
    }
  }

  const escalated = isMoreSevere(candidate.severity, existing.severity);
  const cooldownExpired =
    existing.notifiedAt !== null &&
    now.getTime() - existing.notifiedAt.getTime() >= rule.cooldownMs;

  const action: RecordOutcome['action'] = escalated
    ? 'escalated'
    : cooldownExpired
      ? 'renotified'
      : 'suppressed';

  const updated = await AlertModel.findOneAndUpdate(
    { _id: existing._id },
    {
      $set: {
        lastSeenAt: now,
        // The figures are refreshed on every sighting so the card shows what is
        // true now, not what was true when the condition first opened.
        evidence: candidate.evidence,
        summary: candidate.summary,
        ...(escalated ? { severity: candidate.severity, title: candidate.title } : {}),
      },
      $inc: { occurrences: 1 },
    },
    { returnDocument: 'after' },
  )
    .lean<AlertDocument | null>()
    .exec();

  return { alert: updated ?? existing, action, notified: false };
};

/**
 * Tells the person, if they have asked to hear about this.
 *
 * Three gates, in order of how cheap they are to check: the severity floor they
 * set, then quiet hours. `critical` passes quiet hours only when the account
 * has explicitly allowed it — never by assumption, because an alert that wakes
 * somebody at 03:00 on a default nobody chose is the fastest way to have every
 * alert switched off.
 *
 * The notification carries a dedupe key built from the alert and the occurrence
 * it is reporting, so a scheduler retry after a partial failure re-uses the
 * inbox row rather than writing a second copy.
 */
export const notifyAlert = async (
  actor: AuthenticatedUser,
  alert: AlertDocument,
  now: Date,
): Promise<{ notified: boolean; reason?: string }> => {
  const preferences = await getPreferences(actor);

  if (ALERT_SEVERITY_RANK[alert.severity] < ALERT_SEVERITY_RANK[preferences.minSeverity]) {
    return { notified: false, reason: 'below the configured severity floor' };
  }

  if (isWithinQuietHours(preferences.quietHours, actor.timezone, now)) {
    const bypass = alert.severity === 'critical' && preferences.quietHours.allowCritical;

    if (!bypass) {
      // Suppressed rather than queued: it stays an open alert, so the next
      // evaluation after the window closes will offer it again.
      return { notified: false, reason: 'quiet hours' };
    }
  }

  const report = await deliver(['in_app'], {
    userId: actor.id,
    category: 'alert',
    title: alert.title,
    body: alert.summary,
    dedupeKey: `alert:${String(alert._id)}:${alert.occurrences}`,
    metadata: {
      alertId: String(alert._id),
      alertType: alert.type,
      severity: alert.severity,
      scope: alert.scope,
      entityName: alert.entityName,
    },
  });

  if (!report.delivered) {
    return { notified: false, reason: 'no channel accepted the message' };
  }

  const notificationId = report.results.find((entry) => entry.notificationId)?.notificationId;

  await AlertModel.updateOne(
    { _id: alert._id },
    {
      $set: {
        status: 'notified',
        notifiedAt: now,
        ...(notificationId ? { notification: toObjectId(notificationId) } : {}),
      },
    },
  ).exec();

  return { notified: true };
};

/**
 * Closes alerts whose condition is no longer present.
 *
 * Called with the fingerprints an evaluation *did* raise, so anything open of
 * the same types that is missing from that list has stopped being true. A
 * low-stock alert whose shelf was refilled resolves itself, which is the
 * difference between a list of open problems and a list of things that were
 * once problems.
 *
 * Acknowledged alerts resolve too: somebody having seen it does not mean they
 * want it in the open list forever.
 */
export const resolveMissing = async (
  actor: AuthenticatedUser,
  types: readonly AlertType[],
  stillPresent: readonly string[],
  now: Date,
): Promise<number> => {
  if (types.length === 0) {
    return 0;
  }

  const result = await AlertModel.updateMany(
    ownedBy(actor, {
      type: { $in: types },
      status: { $in: ACTIVE_ALERT_STATUSES },
      fingerprint: { $nin: stillPresent },
    }),
    { $set: { status: 'resolved', resolvedAt: now } },
  ).exec();

  if (result.modifiedCount > 0) {
    log.debug({ userId: actor.id, resolved: result.modifiedCount }, 'alerts resolved');
  }

  return result.modifiedCount;
};

export interface ListAlertsQuery {
  page: number;
  pageSize: number;
  status?: AlertStatus | undefined;
  severity?: AlertSeverity | undefined;
  type?: AlertType | undefined;
  /** True for anything still open, which is the default view. */
  activeOnly?: boolean | undefined;
}

export const listAlerts = async (
  actor: AuthenticatedUser,
  query: ListAlertsQuery,
): Promise<PaginatedResult<AlertDocument>> => {
  const filter = ownedBy(actor, {
    ...(query.status ? { status: query.status } : {}),
    ...(query.activeOnly && !query.status ? { status: { $in: ACTIVE_ALERT_STATUSES } } : {}),
    ...(query.severity ? { severity: query.severity } : {}),
    ...(query.type ? { type: query.type } : {}),
  });
  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    AlertModel.find(filter)
      .sort({ detectedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<AlertDocument[]>()
      .exec(),
    AlertModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const getAlert = async (actor: AuthenticatedUser, id: string): Promise<AlertDocument> => {
  const alert = await AlertModel.findOne(ownedBy(actor, { _id: id }))
    .lean<AlertDocument | null>()
    .exec();

  if (!alert) {
    // Someone else's alert is reported as missing rather than forbidden: a 403
    // would confirm the id exists.
    throw ApiError.notFound('Alert not found');
  }

  return alert;
};

const transition = async (
  actor: AuthenticatedUser,
  id: string,
  status: AlertStatus,
  field: 'acknowledgedAt' | 'dismissedAt' | 'resolvedAt',
  now: Date,
): Promise<AlertDocument> => {
  const updated = await AlertModel.findOneAndUpdate(
    ownedBy(actor, { _id: id }),
    { $set: { status, [field]: now } },
    { returnDocument: 'after' },
  )
    .lean<AlertDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Alert not found');
  }

  return updated;
};

export const acknowledgeAlert = (actor: AuthenticatedUser, id: string, now = new Date()) =>
  transition(actor, id, 'acknowledged', 'acknowledgedAt', now);

export const dismissAlert = (actor: AuthenticatedUser, id: string, now = new Date()) =>
  transition(actor, id, 'dismissed', 'dismissedAt', now);

export const summariseAlerts = async (actor: AuthenticatedUser): Promise<AlertSummary> => {
  const active = await AlertModel.find(ownedBy(actor, { status: { $in: ACTIVE_ALERT_STATUSES } }))
    .select('severity status')
    .lean<Array<Pick<AlertDocument, 'severity' | 'status'>>>()
    .exec();

  const bySeverity: AlertSummary['bySeverity'] = {
    info: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const alert of active) {
    bySeverity[alert.severity] += 1;
  }

  return {
    active: active.length,
    unacknowledged: active.filter((alert) => alert.status !== 'acknowledged').length,
    bySeverity,
  };
};
