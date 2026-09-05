import {
  MCP_AUTH_METHODS,
  MCP_TRANSPORTS,
  type AuthenticatedUser,
  type IntegrationHealth,
  type McpAuthMethod,
  type McpTransport,
} from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { CREDENTIAL_PURPOSE, canStoreCredentials, hasSecret } from '../credential.service.js';
import type { IntegrationDocument } from '../integration.model.js';
import { withMcpConnection, type McpConnectionSettings } from '../mcp/mcp-client.js';
import { isMcpError } from '../mcp/mcp-error.js';
import type { ValidatedMcpTool } from '../mcp/mcp-tool-schema.js';
import { parseMcpServerUrl } from '../mcp/mcp-url.js';
import { withOptionalSecret } from './provider-secret.js';
import type { IntegrationProviderAdapter, ProviderSetupResult } from './provider.types.js';

/**
 * A server the user brought.
 *
 * The other two adapters describe things Hadiya knows. This one describes a
 * thing it does not: an address, a transport, maybe a token, and beyond that
 * whatever the far side chooses to say about itself. Everything protective in
 * the hub exists because of this adapter — the URL check, the schema
 * validation, the permission states, the confirmation flow, the timeouts, the
 * audit trail — and none of it is optional.
 *
 * Note what this file does *not* do: it never decides whether a tool may run.
 * Discovery produces metadata and a suggested permission; execution is gated in
 * `mcp-execution.service.ts` against the stored permission, re-read at call
 * time. Keeping those apart means a compromised or lying server can influence
 * what Hadiya *knows* and never what Hadiya *allows*.
 */
export const mcpProvider: IntegrationProviderAdapter = {
  info: {
    provider: 'custom_mcp',
    type: 'mcp',
    label: 'Custom MCP server',
    description:
      'Connect your own tools. Hadiya discovers what the server offers, and you decide which of them it may use.',
    available: true,
    unavailableReason: null,
    // Only what is actually implemented. OAuth is absent because offering a
    // flow that cannot complete produces an integration stuck forever at
    // "authentication required".
    setupHint:
      'You will need the server address (https), and a token unless the server is open to anyone.',
    authMethods: [...MCP_AUTH_METHODS],
    requiresServerUrl: true,
    // Only when the chosen auth method needs one; `prepare` decides.
    requiresCredential: false,
  },

  prepare: (input, existing): ProviderSetupResult => {
    const serverUrl = input.serverUrl?.trim() ?? existing?.serverUrl ?? '';

    if (!serverUrl) {
      throw ApiError.badRequest('An MCP server address is required.');
    }

    // Validated here, so a private address or a URL with a password in it fails
    // on the form rather than at connection time.
    const url = parseMcpServerUrl(serverUrl);

    const transport: McpTransport =
      input.transport ?? (existing?.transport as McpTransport | null) ?? 'http';

    if (!MCP_TRANSPORTS.includes(transport)) {
      throw ApiError.badRequest('That transport is not supported.');
    }

    const authMethod: McpAuthMethod =
      input.authMethod ?? (existing?.authMethod as McpAuthMethod | null) ?? 'none';

    if (!MCP_AUTH_METHODS.includes(authMethod)) {
      throw ApiError.badRequest('That authentication method is not supported.');
    }

    const authHeaderName =
      authMethod === 'header'
        ? (input.authHeaderName?.trim() ?? existing?.authHeaderName ?? '')
        : null;

    if (authMethod === 'header' && !authHeaderName) {
      throw ApiError.badRequest('A header name is required for header authentication.');
    }

    // A header name goes into an outbound HTTP request, so it must be a header
    // name and not a smuggled second header.
    if (authHeaderName && !/^[A-Za-z0-9-]{1,64}$/.test(authHeaderName)) {
      throw ApiError.badRequest('That header name contains characters a header cannot hold.');
    }

    const secret = input.secret?.trim() ?? '';
    const needsSecret = authMethod !== 'none';

    if (needsSecret && !secret && !existing) {
      throw ApiError.badRequest('A token is required for the chosen authentication method.');
    }

    if (secret && !canStoreCredentials()) {
      throw ApiError.dependencyUnavailable(
        'This deployment cannot store credentials: no encryption key is configured.',
      );
    }

    return {
      patch: {
        serverUrl: url.toString(),
        transport,
        authMethod,
        authHeaderName,
        credentialSource: needsSecret ? 'stored' : 'none',
      },
      secret: secret.length > 0 ? secret : null,
    };
  },

  /**
   * The connection test: handshake, identify, list.
   *
   * `listTools` is a read of the server's own catalogue and changes nothing, so
   * it is safe to run on a button press — and it is also the only way to learn
   * whether the connection is *useful* rather than merely open. No discovered
   * tool is called: pressing "Test connection" must never send an invoice.
   */
  checkHealth: async (actor: AuthenticatedUser, integration): Promise<IntegrationHealth> => {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();

    if (!integration.enabled) {
      return {
        status: 'disabled',
        healthy: false,
        message: 'This integration is switched off.',
        toolCount: 0,
        server: null,
        checkedAt,
        latencyMs: 0,
      };
    }

    try {
      const result = await withConnection(actor, integration, async (client) => ({
        tools: await client.listTools(),
        server: client.serverInfo(),
      }));

      return {
        status: 'connected',
        healthy: true,
        message:
          result.tools.length > 0
            ? `The server answered and offers ${result.tools.length} tool(s).`
            : 'The server answered but offers no tools.',
        toolCount: result.tools.length,
        server: result.server,
        checkedAt,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (isMcpError(error)) {
        return {
          status: 'error',
          healthy: false,
          // Already normalised: never a stack, a URL or an upstream body.
          message: error.safeMessage,
          toolCount: 0,
          server: null,
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };
      }

      throw error;
    }
  },

  discoverTools: async (
    actor: AuthenticatedUser,
    integration: IntegrationDocument,
  ): Promise<{ tools: ValidatedMcpTool[] }> => ({
    tools: await withConnection(actor, integration, (client) => client.listTools()),
  }),
};

/**
 * Opens a connection for one integration, decrypting its token only if it has
 * one and only for as long as the connection lasts.
 */
const withConnection = async <TResult>(
  actor: AuthenticatedUser,
  integration: IntegrationDocument,
  use: Parameters<typeof withMcpConnection<TResult>>[1],
): Promise<TResult> => {
  const integrationId = String(integration._id);
  const authMethod = (integration.authMethod as McpAuthMethod | null) ?? 'none';
  const needsSecret =
    authMethod !== 'none' && (await hasSecret(integrationId, CREDENTIAL_PURPOSE.token));

  const base: Omit<McpConnectionSettings, 'secret'> = {
    serverUrl: integration.serverUrl ?? '',
    transport: (integration.transport as McpTransport | null) ?? 'http',
    authMethod,
    authHeaderName: integration.authHeaderName,
  };

  return withOptionalSecret({ integrationId, userId: actor.id, needsSecret }, (secret) =>
    withMcpConnection({ ...base, secret }, use),
  );
};
