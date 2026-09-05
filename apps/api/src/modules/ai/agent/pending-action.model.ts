import { PENDING_ACTION_STATUSES, type PendingActionStatus } from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../../core/db/create-schema.js';

/**
 * An action the agent has prepared and is waiting to be told to take.
 *
 * This is what makes a confirmation a *server-side* fact rather than a sentence
 * in a transcript. Without it, "the user agreed" is something the model asserts
 * and the server believes — and a model that misread a reply, or a reply that
 * was never given, is then the only thing between a person and a deleted plan.
 * With it, the server itself decided what was being proposed, wrote down the
 * exact arguments, and can check that what it is now being asked to run is
 * still that same thing.
 *
 * Three properties do the work:
 *
 *  - **The arguments are Hadiya's, not the model's.** They are stored after the
 *    tool's own schema has validated them, so what is confirmed is what was
 *    described, and a later call whose arguments have drifted is refused rather
 *    than run.
 *  - **It expires.** An agreement given ten minutes ago to create an invoice is
 *    not an agreement to create one tomorrow, and a conversation that is picked
 *    up the next morning must ask again.
 *  - **It holds no secret.** Arguments are model-generated and pass through a
 *    redaction that drops anything named like a credential. Nothing here is a
 *    token, and nothing here needs to be.
 */
export interface PendingActionDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  conversation: Types.ObjectId;
  /** The run that proposed it; a resumed run gets its own id. */
  workflowId: string;
  /** The model's own id for the call that was refused, for the transcript. */
  requestedCallId: string;
  tool: string;
  /** Validated arguments, redacted. `confirm` is deliberately not among them. */
  arguments: Record<string, unknown>;
  /** A digest of the arguments, so a match is a comparison and not a scan. */
  argumentsHash: string;
  /** What the person was asked, in their terms. Safe to show. */
  description: string;
  integrationId: string | null;
  integrationName: string | null;
  status: PendingActionStatus;
  expiresAt: Date;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const pendingActionSchema = createSchema<PendingActionDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  workflowId: { type: String, required: true, maxlength: 64 },
  requestedCallId: { type: String, required: true, maxlength: 128 },
  tool: { type: String, required: true, maxlength: 128 },
  arguments: { type: Schema.Types.Mixed, default: {} },
  argumentsHash: { type: String, required: true, maxlength: 64 },
  description: { type: String, required: true, maxlength: 500 },
  integrationId: { type: String, default: null },
  integrationName: { type: String, default: null },
  status: { type: String, required: true, enum: PENDING_ACTION_STATUSES, default: 'pending' },
  expiresAt: { type: Date, required: true },
  resolvedAt: { type: Date, default: null },
});

// Resolving a confirmation reads "this person's live proposals in this
// conversation, newest first".
pendingActionSchema.index({ user: 1, conversation: 1, status: 1, createdAt: -1 });

/**
 * Mongo removes an expired record on its own, but only when its reaper next
 * runs — up to a minute late, and later still under load. So expiry is *also*
 * checked in the service, against the stored timestamp, and that check is the
 * authoritative one. This index is housekeeping: it stops the collection
 * growing without bound, and it is not a security control.
 */
pendingActionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PendingActionModel: Model<PendingActionDocument> = model<PendingActionDocument>(
  'PendingAction',
  pendingActionSchema,
);
