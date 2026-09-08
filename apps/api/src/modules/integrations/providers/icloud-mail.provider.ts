import type { AuthenticatedUser, IntegrationHealth } from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { CREDENTIAL_PURPOSE, canStoreCredentials, withSecret } from '../credential.service.js';
import { isMcpError } from '../mcp/mcp-error.js';
import { checkIcloudMailbox, ICLOUD_IMAP_HOST } from './icloud-mail-client.js';
import type { IntegrationProviderAdapter, ProviderSetupResult } from './provider.types.js';

/**
 * An iCloud mailbox, over IMAP.
 *
 * The credential is an **app-specific password**, never the Apple ID password
 * itself. That distinction is the whole security story of this integration: an
 * app-specific password reaches one mailbox, can be revoked from
 * appleid.apple.com without changing anything else, and is refused by every
 * other Apple service — so the worst case of a stolen one is bounded, and the
 * person who granted it can end it without our help.
 *
 * The address is stored as a plain option and the password is encrypted like
 * every other secret. Both are per-account: two employees connecting their own
 * mail must not be able to read each other's.
 */
const PASSWORD_HINT =
  'Sign in at appleid.apple.com → Sign-In and Security → App-Specific Passwords, generate one for Hadiya, and paste it here. Your Apple ID password will not work.';

const readEmail = (value: unknown): string | null => {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();

  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
};

export const icloudMailProvider: IntegrationProviderAdapter = {
  info: {
    provider: 'icloud_mail',
    type: 'native',
    label: 'iCloud Mail',
    description:
      'Your iCloud mailbox over IMAP. Hadiya checks the connection and reads how the inbox stands; it never sends mail and never deletes anything.',
    available: canStoreCredentials(),
    unavailableReason: canStoreCredentials()
      ? null
      : 'This deployment cannot store credentials: no encryption key is configured.',
    setupHint:
      'You will need your Apple ID address and an app-specific password generated at appleid.apple.com.',
    authMethods: [],
    requiresServerUrl: false,
    requiresCredential: true,
  },

  prepare: (input, existing): ProviderSetupResult => {
    const email = readEmail(input.options?.email) ?? readEmail(existing?.options?.email);

    if (!email) {
      throw ApiError.badRequest('An Apple ID email address is required, such as name@icloud.com.');
    }

    const secret = input.secret?.trim();

    // An update that does not mention the password keeps the one on file, so
    // correcting a typo in the address does not mean generating a new password.
    if (!secret) {
      if (!existing) {
        throw ApiError.badRequest(`An app-specific password is required. ${PASSWORD_HINT}`);
      }

      return {
        patch: { credentialSource: 'stored', options: { email, host: ICLOUD_IMAP_HOST } },
        secret: null,
      };
    }

    // Apple issues them as `xxxx-xxxx-xxxx-xxxx`. Checked as a courtesy so the
    // commonest mistake — pasting the Apple ID password — fails on the form with
    // an explanation rather than as a login failure a minute later.
    if (!/^[a-z]{4}(-[a-z]{4}){3}$/i.test(secret)) {
      throw ApiError.badRequest(
        `That is not an app-specific password: Apple issues them as four groups of four letters. ${PASSWORD_HINT}`,
      );
    }

    return {
      patch: { credentialSource: 'stored', options: { email, host: ICLOUD_IMAP_HOST } },
      secret,
    };
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

    const email = readEmail(integration.options?.email);

    if (!email) {
      return failure('No Apple ID address is saved for this mailbox.');
    }

    try {
      const status = await withSecret(
        {
          integrationId: String(integration._id),
          userId: actor.id,
          purpose: CREDENTIAL_PURPOSE.token,
        },
        (password) => checkIcloudMailbox(email, password),
      );

      const counts =
        status.messages === null
          ? 'The mailbox answered.'
          : `INBOX holds ${status.messages} messages, ${status.unseen ?? 0} unread.`;

      return {
        status: 'connected',
        healthy: true,
        message: `Signed in as ${email}. ${counts}`,
        toolCount: 0,
        server: { name: ICLOUD_IMAP_HOST, version: 'IMAP4rev1' },
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
