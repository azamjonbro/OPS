import type { AuthenticatedUser, IntegrationHealth } from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { CREDENTIAL_PURPOSE, canStoreCredentials, withSecret } from '../credential.service.js';
import type { IntegrationDocument } from '../integration.model.js';
import { isMcpError } from '../mcp/mcp-error.js';
import {
  AMOCRM_DOMAINS,
  getAmocrmIdentity,
  isValidAmocrmSubdomain,
  listAmocrmPipelines,
  type AmocrmAccountLocation,
  type AmocrmDomain,
} from './amocrm-client.js';
import type { IntegrationProviderAdapter, ProviderSetupResult } from './provider.types.js';

/**
 * amoCRM, as a native integration.
 *
 * Native for the same reason Notion is: Hadiya knows what a lead, a stage and a
 * contact are, so it can describe them to a model properly and expose only
 * reads. The credential is a long-lived token the person creates in amoCRM
 * (Settings → Integrations → the integration's "Keys and scopes" → long-lived
 * token), pasted once and stored encrypted per account.
 *
 * Two things identify the account and neither is a secret: the subdomain and
 * which of amoCRM's domains it is on. They are kept as options so the person
 * can see which CRM they connected, and so the token can be replaced without
 * retyping them.
 */
const TOKEN_HINT =
  'In amoCRM open Settings → Integrations, open (or create) a private integration, and under "Keys and scopes" generate a long-lived token. Paste that token here.';

const readLocation = (
  options: Record<string, unknown> | undefined,
): AmocrmAccountLocation | null => {
  const subdomain =
    typeof options?.subdomain === 'string' ? options.subdomain.trim().toLowerCase() : '';
  const domain = typeof options?.domain === 'string' ? options.domain.trim().toLowerCase() : '';

  if (!isValidAmocrmSubdomain(subdomain)) {
    return null;
  }

  const chosen = (AMOCRM_DOMAINS as readonly string[]).includes(domain)
    ? (domain as AmocrmDomain)
    : 'amocrm.ru';

  return { subdomain, domain: chosen };
};

/** The account an integration document points at, or null when it never said. */
export const amocrmLocationOf = (
  integration: Pick<IntegrationDocument, 'options'>,
): AmocrmAccountLocation | null => readLocation(integration.options);

export const amocrmProvider: IntegrationProviderAdapter = {
  info: {
    provider: 'amocrm',
    type: 'native',
    label: 'amoCRM',
    description:
      'Your sales pipeline. Hadiya can find a deal, say which stage it is in, read its notes and look up a contact; it never creates, moves or deletes anything.',
    available: canStoreCredentials(),
    unavailableReason: canStoreCredentials()
      ? null
      : 'This deployment cannot store credentials: no encryption key is configured.',
    setupHint:
      'You will need your account subdomain (the part before .amocrm.ru) and a long-lived token generated in amoCRM under Settings → Integrations.',
    authMethods: [],
    requiresServerUrl: false,
    requiresCredential: true,
  },

  prepare: (input, existing): ProviderSetupResult => {
    // A new subdomain replaces the old; leaving it out keeps what is on file.
    const location =
      readLocation(input.options) ?? (existing ? readLocation(existing.options) : null);

    if (!location) {
      throw ApiError.badRequest(
        'An amoCRM subdomain is required: the part of your address before .amocrm.ru, such as "mycompany".',
      );
    }

    const secret = input.secret?.trim();

    if (!secret) {
      if (!existing) {
        throw ApiError.badRequest(`A long-lived token is required. ${TOKEN_HINT}`);
      }

      return { patch: { credentialSource: 'stored', options: { ...location } }, secret: null };
    }

    // Long-lived tokens are JWTs and run to hundreds of characters. Checked as
    // a courtesy so a pasted client secret or API key fails on the form with an
    // explanation, not as a 401 a minute later.
    if (secret.length < 100 || secret.split('.').length !== 3) {
      throw ApiError.badRequest(
        `That does not look like an amoCRM long-lived token, which is a long three-part string. ${TOKEN_HINT}`,
      );
    }

    return { patch: { credentialSource: 'stored', options: { ...location } }, secret };
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

    const location = readLocation(integration.options);

    if (!location) {
      return failure('No amoCRM subdomain is saved for this integration.');
    }

    try {
      // `/account` authenticates and names the account; the pipelines are read
      // so the check can say something a person recognises. Neither touches a
      // lead.
      const { identity, pipelines } = await withSecret(
        {
          integrationId: String(integration._id),
          userId: actor.id,
          purpose: CREDENTIAL_PURPOSE.token,
        },
        async (token) => ({
          identity: await getAmocrmIdentity(location, token),
          pipelines: await listAmocrmPipelines(location, token),
        }),
      );

      const stageCount = pipelines.reduce((total, pipeline) => total + pipeline.stages.length, 0);

      return {
        status: 'connected',
        healthy: true,
        message: `Connected to ${identity.name}: ${pipelines.length} pipeline${pipelines.length === 1 ? '' : 's'}, ${stageCount} stages.`,
        toolCount: 4,
        server: { name: `${location.subdomain}.${location.domain}`, version: 'v4' },
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
