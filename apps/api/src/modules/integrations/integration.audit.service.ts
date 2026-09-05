import {
  buildPaginationMeta,
  resolvePagination,
  type AuthenticatedUser,
  type IntegrationAuditAction,
  type IntegrationProvider,
  type PaginatedResult,
} from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { createLogger } from '../../core/logger/logger.js';
import { IntegrationAuditModel, type IntegrationAuditDocument } from './integration-audit.model.js';

const log = createLogger('integration-audit');

/**
 * The record of what Hadiya did with somebody's integrations.
 *
 * Two rules shape everything here.
 *
 * The first is that writing an audit row must never break the thing it is
 * auditing. A trail is worth having, but not at the price of a failed tool call
 * because a write timed out — so every write is best effort and logs rather
 * than throws. The trade is deliberate: a lost row is a gap in a record, a
 * thrown one is a broken feature.
 *
 * The second is that an audit row is a place secrets go to be discovered. It is
 * long-lived, widely readable and rarely reviewed, so `sanitiseMetadata` is not
 * a formality: nothing reaches storage but scalars on a known-safe key list.
 * Tool arguments and tool results are not on it, and cannot be added by a
 * caller passing them in.
 */

/**
 * Keys allowed into `metadata`.
 *
 * An allow-list, not a redaction pass. Redaction requires guessing which keys
 * are dangerous, and the guess fails the first time a server names a field
 * something unexpected; an allow-list fails safe by default and costs one line
 * when a genuinely useful field appears.
 */
const ALLOWED_METADATA_KEYS = new Set([
  'toolCount',
  'toolsAdded',
  'toolsRemoved',
  'rejectedCount',
  'truncated',
  'durationMs',
  'latencyMs',
  'status',
  'permission',
  'previousPermission',
  'risk',
  'reason',
  'transport',
  'authMethod',
  'server',
  'serverVersion',
  'resultLength',
  'credentialsRevoked',
]);

/** Length beyond which a "reason" is a payload rather than a reason. */
const MAX_TEXT = 300;

const sanitiseMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const safe: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) {
      continue;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      safe[key] = value;
    } else if (typeof value === 'string') {
      safe[key] = value.slice(0, MAX_TEXT);
    }
    // Objects and arrays are dropped: they are how a payload gets in.
  }

  return safe;
};

export interface RecordAuditInput {
  actor: AuthenticatedUser;
  /** `null` for an action on an integration that no longer exists. */
  integrationId: string | null;
  integrationName: string;
  provider: IntegrationProvider;
  action: IntegrationAuditAction;
  tool?: string | null;
  success: boolean;
  metadata?: Record<string, unknown>;
}

/** Writes one line of the trail. Never throws. */
export const recordIntegrationEvent = async (input: RecordAuditInput): Promise<void> => {
  try {
    await IntegrationAuditModel.create({
      user: toObjectId(input.actor.id),
      integration: input.integrationId ? toObjectId(input.integrationId) : null,
      integrationName: input.integrationName.slice(0, 80),
      provider: input.provider,
      action: input.action,
      tool: input.tool ?? null,
      success: input.success,
      metadata: sanitiseMetadata(input.metadata ?? {}),
    });
  } catch (error) {
    log.warn({ action: input.action, err: error }, 'integration audit write failed');
  }
};

export interface ListAuditQuery {
  page: number;
  pageSize: number;
  /** Narrows to one integration; ownership is enforced regardless. */
  integrationId?: string | undefined;
  action?: IntegrationAuditAction | undefined;
}

/**
 * Reads the trail for one account.
 *
 * Scoped to the actor in the filter, like every other read in this module: a
 * person can see what happened to their own integrations and cannot see that
 * anyone else has any.
 */
export const listIntegrationEvents = async (
  actor: AuthenticatedUser,
  query: ListAuditQuery,
): Promise<PaginatedResult<IntegrationAuditDocument>> => {
  const filter: Record<string, unknown> = { user: toObjectId(actor.id) };

  if (query.integrationId) {
    filter.integration = toObjectId(query.integrationId);
  }

  if (query.action) {
    filter.action = query.action;
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    IntegrationAuditModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<IntegrationAuditDocument[]>()
      .exec(),
    IntegrationAuditModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

/**
 * Detaches an integration's history from the integration.
 *
 * Called on delete instead of a cascade. The point of a trail is that it
 * outlives what it describes: removing a CRM must not also remove the record of
 * every invoice Hadiya created through it.
 */
export const detachAuditTrail = async (integrationId: string): Promise<void> => {
  try {
    await IntegrationAuditModel.updateMany(
      { integration: toObjectId(integrationId) },
      { $set: { integration: null } },
    ).exec();
  } catch (error) {
    log.warn({ integrationId, err: error }, 'detaching the audit trail failed');
  }
};
