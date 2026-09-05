import {
  INTEGRATION_AUDIT_ACTIONS,
  INTEGRATION_PROVIDERS,
  type IntegrationAuditAction,
  type IntegrationProvider,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * What was connected, tested, run or switched off, and by whom.
 *
 * Kept because an MCP server is somebody else's code being handed a user's
 * data: when a question is asked later — what did the assistant send to that
 * CRM, which tool ran, who allowed it — the answer has to exist. It also
 * outlives what it describes. `integration` becomes `null` when the integration
 * is deleted, but the name, provider and action stay, so removing a connection
 * cannot quietly erase the record of what it did.
 *
 * `metadata` holds counts, durations and normalised messages. Never arguments,
 * never results, never anything that came back from a server: a tool result may
 * contain a customer's phone number, and an audit trail is not the place to
 * accumulate them. `integration.audit.service.ts` enforces that on the way in.
 */
export interface IntegrationAuditDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  /** Null once the integration has been deleted. */
  integration: Types.ObjectId | null;
  /** Copied at write time so the line still reads after a deletion. */
  integrationName: string;
  provider: IntegrationProvider;
  action: IntegrationAuditAction;
  /** The MCP tool involved, when one was. */
  tool: string | null;
  success: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const auditSchema = createSchema<IntegrationAuditDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  integration: { type: Schema.Types.ObjectId, ref: 'Integration', default: null },
  integrationName: { type: String, required: true, trim: true, maxlength: 80 },
  provider: { type: String, required: true, enum: INTEGRATION_PROVIDERS },
  action: { type: String, required: true, enum: INTEGRATION_AUDIT_ACTIONS },
  tool: { type: String, default: null, trim: true, maxlength: 96 },
  success: { type: Boolean, required: true, default: true },
  metadata: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
});

// The trail as it is read: one account's, newest first.
auditSchema.index({ user: 1, createdAt: -1 });
// And per integration, for the detail screen's activity list.
auditSchema.index({ integration: 1, createdAt: -1 });

export const IntegrationAuditModel: Model<IntegrationAuditDocument> =
  model<IntegrationAuditDocument>('IntegrationAudit', auditSchema);
