import {
  buildPaginationMeta,
  isNativeProvider,
  resolvePagination,
  type AuthenticatedUser,
  type IntegrationProvider,
  type IntegrationStatus,
  type McpToolPermission,
  type PaginatedResult,
} from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import {
  CREDENTIAL_PURPOSE,
  hasAnySecret,
  revokeSecrets,
  storeSecret,
} from './credential.service.js';
import { detachAuditTrail, recordIntegrationEvent } from './integration.audit.service.js';
import { IntegrationModel, type IntegrationDocument } from './integration.model.js';
import { getProviderAdapter } from './providers/index.js';
import type { ProviderSetupInput } from './providers/provider.types.js';

const log = createLogger('integrations');

/**
 * Integrations, scoped to whoever is asking.
 *
 * Ownership here works the way it does in `memory.service.ts`, and for the same
 * reason: the actor's id is part of every *filter*, not a check performed on
 * the document after it comes back. A find that does not match returns nothing,
 * so "someone else's integration" and "no such integration" are the same
 * outcome — which is both the correct authorization and the correct thing to
 * leak, since a 404 tells an attacker less than a 403.
 *
 * That matters more here than for a memory. An integration holds a credential
 * and grants tool access, so a missed check would not merely expose a row: it
 * would let one account run tools against another account's CRM.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

/** Reads one integration, or refuses. The single door for every by-id path. */
export const getOwnedIntegration = async (
  actor: AuthenticatedUser,
  integrationId: string,
): Promise<IntegrationDocument> => {
  const found = await IntegrationModel.findOne(ownedBy(actor, { _id: toObjectId(integrationId) }))
    .lean<IntegrationDocument | null>()
    .exec();

  if (!found) {
    throw ApiError.notFound('Integration not found');
  }

  return found;
};

export interface ListIntegrationsQuery {
  page: number;
  pageSize: number;
  provider?: IntegrationProvider | undefined;
  status?: IntegrationStatus | undefined;
}

export const listIntegrations = async (
  actor: AuthenticatedUser,
  query: ListIntegrationsQuery,
): Promise<PaginatedResult<IntegrationDocument>> => {
  const filter = ownedBy(actor, {
    ...(query.provider === undefined ? {} : { provider: query.provider }),
    ...(query.status === undefined ? {} : { status: query.status }),
  });

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    IntegrationModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<IntegrationDocument[]>()
      .exec(),
    IntegrationModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

/** Whether a secret is on file, which is all a view is told. */
export const describeCredentials = async (integration: IntegrationDocument): Promise<boolean> =>
  integration.credentialSource === 'environment'
    ? // Billz's token is the deployment's and is always present when Billz is
      // configured at all; there is no per-account secret to report on.
      true
    : hasAnySecret(String(integration._id));

export interface CreateIntegrationInput extends ProviderSetupInput {
  provider: IntegrationProvider;
}

/**
 * Creates an integration in the `disconnected` state.
 *
 * Creating is not connecting. The record and its credential are stored, and
 * nothing is called until somebody asks — so a typo in a server address costs a
 * failed test rather than a hung request during creation, and an integration
 * never sits in `connected` on the strength of a handshake nobody performed.
 */
export const createIntegration = async (
  actor: AuthenticatedUser,
  input: CreateIntegrationInput,
): Promise<IntegrationDocument> => {
  const adapter = getProviderAdapter(input.provider);

  if (!adapter.info.available) {
    throw ApiError.badRequest(
      adapter.info.unavailableReason ?? 'That integration is not available on this deployment.',
    );
  }

  // The adapter validates what the person typed and says what to store. It may
  // throw, and it does so before anything is written.
  const prepared = adapter.prepare(input);

  const type = adapter.info.type;

  // One native integration per provider per account. The unique partial index
  // is the real guarantee; this makes the collision a sentence rather than a
  // duplicate-key error.
  if (type === 'native') {
    const existing = await IntegrationModel.exists(
      ownedBy(actor, { provider: input.provider, type: 'native' }),
    ).exec();

    if (existing) {
      throw ApiError.conflict(`${adapter.info.label} is already connected to your account.`);
    }
  }

  const created = await IntegrationModel.create({
    user: toObjectId(actor.id),
    name: input.name,
    description: input.description ?? null,
    type,
    provider: input.provider,
    status: 'disconnected',
    enabled: true,
    options: {},
    metadata: {},
    tools: [],
    ...prepared.patch,
  });

  const integrationId = String(created._id);

  if (prepared.secret) {
    try {
      await storeSecret({
        integrationId,
        userId: actor.id,
        purpose: CREDENTIAL_PURPOSE.token,
        secret: prepared.secret,
      });
    } catch (error) {
      // An integration that cannot hold its credential is not half-created; it
      // is useless and confusing. Remove it and report the real problem.
      await IntegrationModel.deleteOne({ _id: created._id }).exec();

      throw error;
    }
  }

  await recordIntegrationEvent({
    actor,
    integrationId,
    integrationName: created.name,
    provider: created.provider,
    action: 'integration_created',
    success: true,
    metadata: {
      ...(created.transport ? { transport: created.transport } : {}),
      ...(created.authMethod ? { authMethod: created.authMethod } : {}),
    },
  });

  return created.toObject<IntegrationDocument>();
};

export interface UpdateIntegrationInput extends Partial<ProviderSetupInput> {
  enabled?: boolean | undefined;
}

/**
 * Changes an integration's settings.
 *
 * Anything that alters how Hadiya reaches the server — the URL, the transport,
 * the auth method, the token — invalidates what was discovered through the old
 * settings, so the integration drops back to `disconnected` and its tools are
 * cleared. Keeping them would leave a permission table describing a server that
 * is no longer the one being called, which is the sort of stale state a person
 * would reasonably read as a promise.
 */
export const updateIntegration = async (
  actor: AuthenticatedUser,
  integrationId: string,
  input: UpdateIntegrationInput,
): Promise<IntegrationDocument> => {
  const existing = await getOwnedIntegration(actor, integrationId);
  const adapter = getProviderAdapter(existing.provider);

  const touchesConnection =
    input.serverUrl !== undefined ||
    input.transport !== undefined ||
    input.authMethod !== undefined ||
    input.authHeaderName !== undefined ||
    input.secret !== undefined;

  const prepared = touchesConnection
    ? adapter.prepare({ ...input, name: input.name ?? existing.name }, existing)
    : { patch: {}, secret: null };

  if (prepared.secret) {
    await storeSecret({
      integrationId,
      userId: actor.id,
      purpose: CREDENTIAL_PURPOSE.token,
      secret: prepared.secret,
    });
  }

  const patch: Record<string, unknown> = {
    ...prepared.patch,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.description === undefined ? {} : { description: input.description }),
  };

  if (input.enabled !== undefined) {
    patch.enabled = input.enabled;

    // Switching off is immediate and does not wait for a probe: the point of
    // the switch is that the tools stop being offered now.
    if (!input.enabled) {
      patch.status = 'disabled';
    } else if (existing.status === 'disabled') {
      // Switching back on returns it to "not connected yet" rather than to
      // "connected" — whether it still works is a question only a test answers.
      patch.status = 'disconnected';
    }
  }

  if (touchesConnection) {
    patch.status = input.enabled === false ? 'disabled' : 'disconnected';
    patch.tools = [];
    patch.toolsRefreshedAt = null;
    patch.lastError = null;
    patch.lastErrorAt = null;
  }

  const updated = await IntegrationModel.findOneAndUpdate(
    ownedBy(actor, { _id: toObjectId(integrationId) }),
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<IntegrationDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Integration not found');
  }

  await recordIntegrationEvent({
    actor,
    integrationId,
    integrationName: updated.name,
    provider: updated.provider,
    action: 'integration_updated',
    success: true,
    metadata: { reason: touchesConnection ? 'connection settings changed' : 'details changed' },
  });

  return updated;
};

/**
 * Removes an integration and everything that let it act.
 *
 * The order matters. Credentials go first, so that even if the rest fails
 * halfway the token is already gone — the worst outcome becomes an orphaned row
 * with no power rather than a live credential nobody can see. The audit trail
 * is detached rather than deleted, so what the integration did survives it.
 */
export const deleteIntegration = async (
  actor: AuthenticatedUser,
  integrationId: string,
): Promise<void> => {
  const existing = await getOwnedIntegration(actor, integrationId);

  const revoked = await revokeSecrets(integrationId);

  await detachAuditTrail(integrationId);

  const result = await IntegrationModel.deleteOne(
    ownedBy(actor, { _id: toObjectId(integrationId) }),
  ).exec();

  if (result.deletedCount === 0) {
    throw ApiError.notFound('Integration not found');
  }

  await recordIntegrationEvent({
    actor,
    integrationId: null,
    integrationName: existing.name,
    provider: existing.provider,
    action: 'integration_deleted',
    success: true,
    metadata: { credentialsRevoked: revoked },
  });

  log.info({ integrationId, provider: existing.provider }, 'integration deleted');
};

/**
 * Changes what the model may do with one discovered tool.
 *
 * Only MCP integrations have per-tool permissions; a native provider's
 * capabilities were chosen when they were written, and pretending otherwise
 * would offer a switch that controls nothing.
 *
 * `permissionSetAt` is what makes the choice stick: the next discovery run sees
 * that a person decided this one and leaves it alone. Without it, refreshing
 * would silently re-enable everything somebody had blocked.
 */
export const setToolPermission = async (
  actor: AuthenticatedUser,
  integrationId: string,
  toolName: string,
  permission: McpToolPermission,
): Promise<IntegrationDocument> => {
  const existing = await getOwnedIntegration(actor, integrationId);

  if (isNativeProvider(existing.provider)) {
    throw ApiError.badRequest('This integration does not have per-tool permissions.');
  }

  const tool = existing.tools.find((candidate) => candidate.name === toolName);

  if (!tool) {
    throw ApiError.notFound('That tool is not one this integration offers.');
  }

  const updated = await IntegrationModel.findOneAndUpdate(
    ownedBy(actor, { _id: toObjectId(integrationId), 'tools.name': toolName }),
    { $set: { 'tools.$.permission': permission, 'tools.$.permissionSetAt': new Date() } },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<IntegrationDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('That tool is not one this integration offers.');
  }

  await recordIntegrationEvent({
    actor,
    integrationId,
    integrationName: updated.name,
    provider: updated.provider,
    action: 'mcp_tool_permission_changed',
    tool: toolName,
    success: true,
    metadata: { permission, previousPermission: tool.permission, risk: tool.risk },
  });

  return updated;
};

/**
 * The integrations whose tools the agent may currently be given.
 *
 * `enabled` and `connected` both, because they answer different questions —
 * whether the person wants it and whether it works — and a tool should be
 * offered only when both are yes. This is the query the per-turn tool registry
 * is built from, so it is also the one place "which tools does the AI have"
 * is decided.
 */
export const listUsableIntegrations = async (
  actor: AuthenticatedUser,
): Promise<IntegrationDocument[]> =>
  IntegrationModel.find(ownedBy(actor, { enabled: true, status: 'connected' }))
    .sort({ createdAt: 1 })
    .lean<IntegrationDocument[]>()
    .exec();
