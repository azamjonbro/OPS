import { createHash } from 'node:crypto';

import type { AuthenticatedUser, PendingActionSummary } from '@hadiya/shared';

import { config } from '../../../config/index.js';
import { toObjectId } from '../../../core/db/object-id.js';
import { createLogger } from '../../../core/logger/logger.js';
import { PendingActionModel, type PendingActionDocument } from './pending-action.model.js';

const log = createLogger('agent-pending-actions');

/**
 * Proposals waiting on a person, and the rules for honouring one.
 *
 * Everything here is scoped by `(user, conversation)` and read back from the
 * database rather than carried in memory between turns: a confirmation may
 * arrive minutes later, on a different request, quite possibly served by a
 * different process, and the only thing those have in common is the row.
 */

/** Keys whose values are dropped before anything is written down. */
const SENSITIVE_KEY = /(token|secret|password|credential|api[_-]?key|authorization|cookie|pin)/i;

/**
 * Strips anything that looks like a credential out of a set of arguments.
 *
 * Model-written arguments should never contain one, and a well-behaved tool
 * takes its secrets from the credential store rather than from the model. This
 * is the belt to that braces: a person who pasted a token into the chat, and a
 * model that helpfully passed it along, must not end up with it stored in a
 * record whose whole purpose is to be read back later.
 */
export const redactArguments = (args: Record<string, unknown>): Record<string, unknown> => {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(args)) {
    if (SENSITIVE_KEY.test(key)) {
      safe[key] = '[redacted]';
      continue;
    }

    // `confirm` is Hadiya's own field and is never part of what was proposed:
    // storing it would mean comparing a proposal against a confirmation on a
    // field that is false in one and true in the other.
    if (key === 'confirm') {
      continue;
    }

    safe[key] = value;
  }

  return safe;
};

/**
 * A stable digest of a set of arguments.
 *
 * Keys are sorted so that two objects that mean the same thing hash the same
 * whatever order the model wrote them in, and the hash — rather than the object
 * — is what a confirmation is matched against, so the comparison cannot be
 * fooled by key order or by an added `undefined`.
 */
export const hashArguments = (args: Record<string, unknown>): string => {
  const canonical = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(canonical);
    }

    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, entry]) => [key, canonical(entry)]),
      );
    }

    return value;
  };

  return createHash('sha256').update(JSON.stringify(canonical(args) ?? null)).digest('hex');
};

export const toPendingActionSummary = (
  document: PendingActionDocument,
): PendingActionSummary => ({
  id: String(document._id),
  conversationId: String(document.conversation),
  workflowId: document.workflowId,
  tool: document.tool,
  description: document.description,
  status: document.status,
  integrationId: document.integrationId,
  integrationName: document.integrationName,
  createdAt: document.createdAt.toISOString(),
  expiresAt: document.expiresAt.toISOString(),
});

export interface RecordPendingActionInput {
  conversationId: string;
  workflowId: string;
  requestedCallId: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
  integrationId?: string | null;
  integrationName?: string | null;
  /** Injected by tests; defaults to the configured TTL from now. */
  expiresAt?: Date;
}

/**
 * Writes down what the person is about to be asked.
 *
 * Any earlier live proposal of the same tool in the same conversation is
 * cancelled first. A model that re-proposes with different arguments has
 * changed its mind, and leaving both alive would mean a later "ha" could match
 * whichever one happened to be found first — the oldest, in practice, which is
 * the one the person is least likely to have meant.
 */
export const recordPendingAction = async (
  actor: AuthenticatedUser,
  input: RecordPendingActionInput,
): Promise<PendingActionDocument> => {
  const args = redactArguments(input.args);
  const now = new Date();

  await PendingActionModel.updateMany(
    {
      user: toObjectId(actor.id),
      conversation: toObjectId(input.conversationId),
      tool: input.tool,
      status: 'pending',
    },
    { $set: { status: 'cancelled', resolvedAt: now } },
  ).exec();

  const [created] = await PendingActionModel.create([
    {
      user: toObjectId(actor.id),
      conversation: toObjectId(input.conversationId),
      workflowId: input.workflowId,
      requestedCallId: input.requestedCallId,
      tool: input.tool,
      arguments: args,
      argumentsHash: hashArguments(args),
      description: input.description.slice(0, 500),
      integrationId: input.integrationId ?? null,
      integrationName: input.integrationName ?? null,
      status: 'pending',
      expiresAt: input.expiresAt ?? new Date(now.getTime() + config.agent.confirmationTtlMs),
    },
  ]);

  if (!created) {
    throw new Error('The pending action could not be stored');
  }

  log.info(
    { user: actor.id, conversation: input.conversationId, tool: input.tool },
    'confirmation requested',
  );

  return created.toObject<PendingActionDocument>();
};

/** Live proposals in one conversation, newest first. Expired ones are excluded. */
export const listPendingActions = async (
  actor: AuthenticatedUser,
  conversationId: string,
  now: Date = new Date(),
): Promise<PendingActionDocument[]> =>
  PendingActionModel.find({
    user: toObjectId(actor.id),
    conversation: toObjectId(conversationId),
    status: 'pending',
    expiresAt: { $gt: now },
  })
    .sort({ createdAt: -1 })
    .lean<PendingActionDocument[]>()
    .exec();

/**
 * The verdict on a confirmed call.
 *
 * `missing` is separated from `expired` and `mismatched` deliberately: only the
 * first is ambiguous. A proposal that has run out of time, or whose arguments
 * have changed since it was made, is a definite "ask again" — the person agreed
 * to something else. A confirmation with no proposal behind it at all is the
 * case where policy has to decide, because a model that proposes and confirms
 * inside one turn produces it legitimately.
 */
export type ConfirmationVerdict =
  | { kind: 'confirmed'; action: PendingActionDocument }
  | { kind: 'expired'; action: PendingActionDocument }
  | { kind: 'mismatched'; action: PendingActionDocument }
  | { kind: 'missing' };

export interface ConsumeInput {
  conversationId: string;
  tool: string;
  args: Record<string, unknown>;
  now?: Date;
}

/**
 * Checks a confirmed call against what this server actually proposed, and
 * spends the proposal if it matches.
 *
 * The update is conditional on the row still being `pending`, so two requests
 * racing the same confirmation cannot both win: one flips the status, the other
 * finds nothing to flip and is told the proposal is gone.
 */
export const consumePendingAction = async (
  actor: AuthenticatedUser,
  input: ConsumeInput,
): Promise<ConfirmationVerdict> => {
  const now = input.now ?? new Date();

  // Expired rows are read too — Mongo may not have swept them yet, and telling
  // somebody their confirmation timed out is far better than telling them
  // nothing was ever proposed.
  const candidates = await PendingActionModel.find({
    user: toObjectId(actor.id),
    conversation: toObjectId(input.conversationId),
    tool: input.tool,
    status: 'pending',
  })
    .sort({ createdAt: -1 })
    .lean<PendingActionDocument[]>()
    .exec();

  if (candidates.length === 0) {
    return { kind: 'missing' };
  }

  const hash = hashArguments(redactArguments(input.args));
  const matching = candidates.find((candidate) => candidate.argumentsHash === hash);
  const action = matching ?? candidates[0];

  if (!action) {
    return { kind: 'missing' };
  }

  if (action.expiresAt.getTime() <= now.getTime()) {
    await PendingActionModel.updateOne(
      { _id: action._id, status: 'pending' },
      { $set: { status: 'expired', resolvedAt: now } },
    ).exec();

    return { kind: 'expired', action };
  }

  if (!matching) {
    return { kind: 'mismatched', action };
  }

  const outcome = await PendingActionModel.updateOne(
    { _id: action._id, status: 'pending' },
    { $set: { status: 'confirmed', resolvedAt: now } },
  ).exec();

  if (outcome.modifiedCount === 0) {
    // Somebody else spent it between the read and the write.
    return { kind: 'missing' };
  }

  log.info({ user: actor.id, tool: input.tool }, 'confirmation accepted');

  return { kind: 'confirmed', action };
};

/**
 * Withdraws every live proposal in a conversation.
 *
 * Used when a run is cancelled and when the person says no. A withdrawn
 * proposal can never later be matched by a stray `confirm: true`, which is the
 * property that makes cancellation mean something for a destructive call.
 */
export const cancelPendingActions = async (
  actor: AuthenticatedUser,
  conversationId: string,
): Promise<number> => {
  const outcome = await PendingActionModel.updateMany(
    {
      user: toObjectId(actor.id),
      conversation: toObjectId(conversationId),
      status: 'pending',
    },
    { $set: { status: 'cancelled', resolvedAt: new Date() } },
  ).exec();

  return outcome.modifiedCount;
};
