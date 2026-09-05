import type { AuthenticatedUser, IntegrationHealth, IntegrationStatus } from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { revokeSecrets } from './credential.service.js';
import { recordIntegrationEvent } from './integration.audit.service.js';
import { IntegrationModel, type IntegrationDocument } from './integration.model.js';
import { getOwnedIntegration } from './integration.service.js';
import { isMcpError } from './mcp/mcp-error.js';
import { initialPermissionFor } from './mcp/mcp-permissions.js';
import type { ValidatedMcpTool } from './mcp/mcp-tool-schema.js';
import { getProviderAdapter } from './providers/index.js';

const log = createLogger('integrations-connect');

/**
 * Connecting, testing, refreshing and disconnecting.
 *
 * Kept apart from `integration.service.ts` because the two have different
 * failure modes and different risks. That file talks to the database and can be
 * reasoned about locally. This one talks to servers Hadiya does not control:
 * everything here can hang, lie, or fail in a way that must not be repeated
 * verbatim to a person — so this is where deadlines, normalised errors and the
 * status machine live.
 */

/** Writes the outcome of a probe onto the integration. */
const applyHealth = async (
  actor: AuthenticatedUser,
  integrationId: string,
  health: IntegrationHealth,
  extra: Record<string, unknown> = {},
): Promise<IntegrationDocument> => {
  const now = new Date();

  const patch: Record<string, unknown> = {
    status: health.status,
    ...extra,
    ...(health.healthy
      ? { lastConnectedAt: now, lastError: null, lastErrorAt: null }
      : // `message` has already been through `McpError.safeMessage` or a
        // provider's own normalisation, so what is stored is safe to render.
        { lastError: health.message.slice(0, 500), lastErrorAt: now }),
    ...(health.server
      ? { metadata: { server: health.server.name, version: health.server.version } }
      : {}),
  };

  const updated = await IntegrationModel.findOneAndUpdate(
    { _id: toObjectId(integrationId), user: toObjectId(actor.id) },
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<IntegrationDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Integration not found');
  }

  return updated;
};

/**
 * Tests an integration without changing anything on the far side.
 *
 * A failed test is not an error response. "Your CRM is unreachable" is the
 * answer to the question that was asked, and returning a 503 for it would make
 * the screen show an error banner instead of the diagnosis somebody pressed the
 * button for. What it does do is record the failure, so the integration's own
 * state reflects reality afterwards.
 */
export const testIntegration = async (
  actor: AuthenticatedUser,
  integrationId: string,
): Promise<{ integration: IntegrationDocument; health: IntegrationHealth }> => {
  const existing = await getOwnedIntegration(actor, integrationId);
  const adapter = getProviderAdapter(existing.provider);

  const health = await adapter.checkHealth(actor, existing);
  const integration = await applyHealth(actor, integrationId, {
    ...health,
    // A test never promotes an integration to `connected`: that is what
    // `connectIntegration` is for, and it does more than probe. A healthy test
    // on a disconnected integration reports health and leaves the state alone.
    status: health.healthy && existing.status === 'connected' ? 'connected' : existing.status,
  });

  await recordIntegrationEvent({
    actor,
    integrationId,
    integrationName: existing.name,
    provider: existing.provider,
    action: 'integration_tested',
    success: health.healthy,
    metadata: {
      latencyMs: health.latencyMs,
      toolCount: health.toolCount,
      ...(health.healthy ? {} : { reason: health.message }),
    },
  });

  return { integration, health };
};

/**
 * Merges a fresh discovery into what is stored.
 *
 * Three rules, and each exists because of a way this could go wrong:
 *
 *  - A tool a person has ruled on keeps their ruling. Otherwise a refresh
 *    re-enables what somebody blocked, which is the worst bug this feature
 *    could have.
 *  - A tool nobody has ruled on takes the permission its *current*
 *    classification earns, so a tool that has quietly become destructive since
 *    it was last seen is demoted rather than grandfathered.
 *  - A tool the server no longer offers is dropped. Keeping it would leave a
 *    permission table listing tools that cannot run.
 */
const mergeTools = (
  existing: IntegrationDocument['tools'],
  discovered: ValidatedMcpTool[],
): IntegrationDocument['tools'] => {
  const previous = new Map(existing.map((tool) => [tool.name, tool]));
  const now = new Date();

  return discovered.map((tool) => {
    const before = previous.get(tool.name);
    const permission = initialPermissionFor(
      tool.risk,
      before
        ? { permission: before.permission, permissionSetAt: before.permissionSetAt }
        : undefined,
    );

    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      risk: tool.risk,
      permission: permission.permission,
      permissionSetAt: permission.permissionSetAt,
      discoveredAt: now,
    };
  });
};

export interface ConnectResult {
  integration: IntegrationDocument;
  health: IntegrationHealth;
  /** Names discovered on this run; empty for a native provider. */
  discovered: string[];
}

/**
 * Brings an integration up: handshake, discover, store, mark connected.
 *
 * The sequence is the one in the connection flow a person sees, and the
 * ordering is load-bearing. Tools are written *before* the status becomes
 * `connected`, so there is no instant at which the agent could be handed an
 * integration marked usable whose tool list is empty or stale.
 *
 * A failure leaves the integration in `error` with a safe message rather than
 * throwing: "could not connect" is a state the screen knows how to show, and
 * one somebody can act on.
 */
export const connectIntegration = async (
  actor: AuthenticatedUser,
  integrationId: string,
): Promise<ConnectResult> => {
  const existing = await getOwnedIntegration(actor, integrationId);

  if (!existing.enabled) {
    throw ApiError.badRequest('Switch this integration on before connecting it.');
  }

  const adapter = getProviderAdapter(existing.provider);

  await IntegrationModel.updateOne(
    { _id: toObjectId(integrationId), user: toObjectId(actor.id) },
    { $set: { status: 'connecting' satisfies IntegrationStatus } },
  ).exec();

  const health = await adapter.checkHealth(actor, existing);

  if (!health.healthy) {
    const integration = await applyHealth(actor, integrationId, { ...health, status: 'error' });

    await recordIntegrationEvent({
      actor,
      integrationId,
      integrationName: existing.name,
      provider: existing.provider,
      action: 'integration_connected',
      success: false,
      metadata: { reason: health.message, latencyMs: health.latencyMs },
    });

    return { integration, health, discovered: [] };
  }

  let discovered: ValidatedMcpTool[] = [];

  if (adapter.discoverTools) {
    try {
      discovered = (await adapter.discoverTools(actor, existing)).tools;
    } catch (error) {
      if (!isMcpError(error)) {
        throw error;
      }

      // The handshake worked and the catalogue did not. That is a real failure
      // — an integration with no tools can do nothing — so it is recorded as
      // one rather than left looking connected and inert.
      const failed: IntegrationHealth = {
        ...health,
        status: 'error',
        healthy: false,
        message: error.safeMessage,
      };

      const integration = await applyHealth(actor, integrationId, failed);

      await recordIntegrationEvent({
        actor,
        integrationId,
        integrationName: existing.name,
        provider: existing.provider,
        action: 'mcp_tools_discovered',
        success: false,
        metadata: { reason: error.safeMessage },
      });

      return { integration, health: failed, discovered: [] };
    }
  }

  const merged = mergeTools(existing.tools, discovered);

  const integration = await applyHealth(
    actor,
    integrationId,
    { ...health, status: 'connected' },
    adapter.discoverTools ? { tools: merged, toolsRefreshedAt: new Date() } : {},
  );

  await recordIntegrationEvent({
    actor,
    integrationId,
    integrationName: existing.name,
    provider: existing.provider,
    action: 'integration_connected',
    success: true,
    metadata: { toolCount: merged.length, latencyMs: health.latencyMs },
  });

  if (adapter.discoverTools) {
    await recordIntegrationEvent({
      actor,
      integrationId,
      integrationName: existing.name,
      provider: existing.provider,
      action: 'mcp_tools_discovered',
      success: true,
      metadata: {
        toolCount: merged.length,
        toolsAdded: merged.filter((tool) => !existing.tools.some((old) => old.name === tool.name))
          .length,
        toolsRemoved: existing.tools.filter((old) => !merged.some((tool) => tool.name === old.name))
          .length,
      },
    });
  }

  return { integration, health, discovered: merged.map((tool) => tool.name) };
};

/**
 * Re-runs discovery on an integration that is already up.
 *
 * Separate from `connect` because it means something different to a person:
 * "the server has new tools", not "try again". It refuses on an integration
 * that is not connected, where the honest action is to connect it.
 */
export const refreshIntegrationTools = async (
  actor: AuthenticatedUser,
  integrationId: string,
): Promise<ConnectResult> => {
  const existing = await getOwnedIntegration(actor, integrationId);

  if (!getProviderAdapter(existing.provider).discoverTools) {
    throw ApiError.badRequest('This integration does not discover its tools.');
  }

  if (!existing.enabled || existing.status !== 'connected') {
    throw ApiError.badRequest('Connect this integration before refreshing its tools.');
  }

  return connectIntegration(actor, integrationId);
};

/**
 * Takes an integration down and withdraws what it was given.
 *
 * Disconnecting destroys the stored credential rather than parking it. A person
 * who disconnects their CRM has withdrawn Hadiya's access to it, and an
 * encrypted token kept "in case they come back" would mean they had not.
 * Reconnecting asks for it again, which is the honest cost of that promise.
 *
 * The discovered tools stay, without their credential and behind a
 * `disconnected` status. They are what the permission table showed, and losing
 * a carefully-set table because somebody paused an integration for a day would
 * be its own kind of unkindness.
 */
export const disconnectIntegration = async (
  actor: AuthenticatedUser,
  integrationId: string,
): Promise<IntegrationDocument> => {
  const existing = await getOwnedIntegration(actor, integrationId);
  const revoked = await revokeSecrets(integrationId);

  const updated = await IntegrationModel.findOneAndUpdate(
    { _id: toObjectId(integrationId), user: toObjectId(actor.id) },
    {
      $set: {
        status: 'disconnected' satisfies IntegrationStatus,
        lastError: null,
        lastErrorAt: null,
      },
    },
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
    integrationName: existing.name,
    provider: existing.provider,
    action: 'integration_disconnected',
    success: true,
    metadata: { credentialsRevoked: revoked },
  });

  log.info({ integrationId, provider: existing.provider }, 'integration disconnected');

  return updated;
};
