import type { AuthenticatedUser, IntegrationHealth } from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { CREDENTIAL_PURPOSE, canStoreCredentials, withSecret } from '../credential.service.js';
import { isMcpError } from '../mcp/mcp-error.js';
import { getNotionIdentity } from './notion-client.js';
import type { IntegrationProviderAdapter, ProviderSetupResult } from './provider.types.js';

/**
 * Notion, as a native integration.
 *
 * Native rather than MCP even though Notion publishes an MCP server, and the
 * reason is the same one that keeps Billz native: Hadiya knows what these
 * endpoints mean. It can choose that only reads are exposed, write descriptions
 * a model understands, and bound a page's text before it reaches a context
 * window. None of that is available for a server Hadiya has never seen.
 *
 * Unlike Billz, the credential is the *person's*. A Notion internal integration
 * token grants access to one workspace's shared pages, so it is stored per
 * account, encrypted, and can be withdrawn by disconnecting — which deletes it
 * rather than merely ignoring it.
 */
const TOKEN_HINT =
  'Create an internal integration at notion.so/my-integrations, share the pages you want Hadiya to see with it, and paste its token here.';

export const notionProvider: IntegrationProviderAdapter = {
  info: {
    provider: 'notion',
    type: 'native',
    label: 'Notion',
    description:
      'Your workspace notes. Hadiya can search the pages you share with it and quote them back; it never edits them.',
    available: canStoreCredentials(),
    unavailableReason: canStoreCredentials()
      ? null
      : 'This deployment cannot store credentials: no encryption key is configured.',
    authMethods: [],
    requiresServerUrl: false,
    requiresCredential: true,
  },

  prepare: (input, existing): ProviderSetupResult => {
    const secret = input.secret?.trim();

    // An update that does not mention the token keeps the one on file: a person
    // renaming their integration should not have to paste a secret again.
    if (!secret) {
      if (!existing) {
        throw ApiError.badRequest(`A Notion integration token is required. ${TOKEN_HINT}`);
      }

      return { patch: { credentialSource: 'stored' }, secret: null };
    }

    // Notion tokens are `ntn_…` now and `secret_…` historically. Checked as a
    // courtesy so an obvious paste error fails on the form rather than as an
    // authentication failure later; not as security, since only Notion can say
    // whether a token is real.
    if (secret.length < 20) {
      throw ApiError.badRequest(`That does not look like a Notion token. ${TOKEN_HINT}`);
    }

    return { patch: { credentialSource: 'stored' }, secret };
  },

  checkHealth: async (actor: AuthenticatedUser, integration): Promise<IntegrationHealth> => {
    const startedAt = Date.now();
    const checkedAt = new Date().toISOString();

    const failure = (message: string): IntegrationHealth => ({
      status: 'error',
      healthy: false,
      message,
      toolCount: 0,
      server: null,
      checkedAt,
      latencyMs: Date.now() - startedAt,
    });

    if (!integration.enabled) {
      return { ...failure('This integration is switched off.'), status: 'disabled' };
    }

    try {
      // `users/me` is the whole health check: it authenticates, proves the
      // token still works and reads nothing that belongs to anybody.
      const identity = await withSecret(
        {
          integrationId: String(integration._id),
          userId: actor.id,
          purpose: CREDENTIAL_PURPOSE.token,
        },
        (token) => getNotionIdentity(token),
      );

      return {
        status: 'connected',
        healthy: true,
        message: identity.workspaceName
          ? `Connected to the ${identity.workspaceName} workspace.`
          : 'Notion answered.',
        toolCount: 2,
        server: { name: identity.name, version: 'v1' },
        checkedAt,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (isMcpError(error)) {
        return failure(error.safeMessage);
      }

      throw error;
    }
  },
};
