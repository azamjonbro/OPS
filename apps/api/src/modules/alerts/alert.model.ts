import {
  ALERT_SCOPES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TYPES,
  DEFAULT_MIN_NOTIFY_SEVERITY,
  DEFAULT_QUIET_HOURS,
  type AlertEvidence,
  type AlertScope,
  type AlertSeverity,
  type AlertStatus,
  type AlertType,
  type QuietHours,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One detected business condition.
 *
 * The row is per *condition*, not per sighting: an evaluation that finds the
 * same thing again updates `lastSeenAt` and `occurrences` rather than inserting
 * a second row. That is what turns "evaluate every hour" into "tell me once",
 * and it is enforced by the unique index below rather than by a check the
 * evaluator could race with itself on.
 */
export interface AlertDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: AlertType;
  severity: AlertSeverity;
  status: AlertStatus;
  scope: AlertScope;
  entityKind: AlertScope;
  entityExternalId: string | null;
  entityName: string | null;
  title: string;
  summary: string;
  evidence: AlertEvidence;
  /** Identity of the condition. Severity is deliberately not part of it. */
  fingerprint: string;
  occurrences: number;
  detectedAt: Date;
  lastSeenAt: Date;
  notifiedAt: Date | null;
  acknowledgedAt: Date | null;
  resolvedAt: Date | null;
  dismissedAt: Date | null;
  notification: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const alertSchema = createSchema<AlertDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: { type: String, required: true, enum: ALERT_TYPES },
  severity: { type: String, required: true, enum: ALERT_SEVERITIES, default: 'medium' },
  status: { type: String, required: true, enum: ALERT_STATUSES, default: 'detected' },
  scope: { type: String, required: true, enum: ALERT_SCOPES, default: 'business' },
  entityKind: { type: String, required: true, enum: ALERT_SCOPES, default: 'business' },
  entityExternalId: { type: String, default: null, maxlength: 120 },
  entityName: { type: String, default: null, maxlength: 200 },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  summary: { type: String, required: true, trim: true, maxlength: 2_000 },
  evidence: { type: Schema.Types.Mixed, required: true },
  fingerprint: { type: String, required: true, maxlength: 200 },
  occurrences: { type: Number, required: true, default: 1, min: 1 },
  detectedAt: { type: Date, required: true },
  lastSeenAt: { type: Date, required: true },
  notifiedAt: { type: Date, default: null },
  acknowledgedAt: { type: Date, default: null },
  resolvedAt: { type: Date, default: null },
  dismissedAt: { type: Date, default: null },
  notification: { type: Schema.Types.ObjectId, ref: 'Notification', default: null },
});

/**
 * The anti-spam guarantee, enforced by the database.
 *
 * One *open* alert per condition per account. The partial filter is what makes
 * it work: a resolved alert leaves the constraint, so the same condition
 * recurring next month opens a new alert with its own history rather than
 * being rejected as a duplicate of one that is long over.
 */
alertSchema.index(
  { user: 1, fingerprint: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ['detected', 'notified', 'acknowledged'] },
    },
  },
);
// The inbox read: this account's alerts, newest first, filtered by status.
alertSchema.index({ user: 1, status: 1, detectedAt: -1 });
// Retention sweeps.
alertSchema.index({ status: 1, updatedAt: 1 });

export const AlertModel: Model<AlertDocument> = model<AlertDocument>('Alert', alertSchema);

/**
 * What one account has chosen to hear about.
 *
 * One document per account, created on first read. A missing document means
 * "the shipped defaults", which is why nothing here is required — an account
 * that has never opened settings must behave identically to one that opened
 * them and changed nothing.
 */
export interface AlertPreferenceDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  disabledTypes: AlertType[];
  minSeverity: AlertSeverity;
  quietHours: QuietHours;
  createdAt: Date;
  updatedAt: Date;
}

const alertPreferenceSchema = createSchema<AlertPreferenceDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  disabledTypes: { type: [String], required: true, default: [], enum: ALERT_TYPES },
  minSeverity: {
    type: String,
    required: true,
    enum: ALERT_SEVERITIES,
    default: DEFAULT_MIN_NOTIFY_SEVERITY,
  },
  quietHours: {
    type: Schema.Types.Mixed,
    required: true,
    default: () => ({ ...DEFAULT_QUIET_HOURS }),
  },
});

alertPreferenceSchema.index({ user: 1 }, { unique: true });

export const AlertPreferenceModel: Model<AlertPreferenceDocument> = model<AlertPreferenceDocument>(
  'AlertPreference',
  alertPreferenceSchema,
);
