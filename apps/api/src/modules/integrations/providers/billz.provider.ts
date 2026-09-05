import type { AuthenticatedUser, IntegrationHealth } from '@hadiya/shared';

import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/http/api-error.js';
import { BILLZ_CAPABILITIES, checkBillzConnection } from '../../billz/index.js';
import type { IntegrationProviderAdapter, ProviderSetupResult } from './provider.types.js';

/**
 * Billz, as the hub sees it.
 *
 * Billz stays exactly what it was — a native module with its own client, its
 * own capability list and its own read-only tools. Nothing here reimplements
 * any of that, and nothing here converts it to MCP for the sake of a tidy
 * diagram: MCP is for servers Hadiya does not know, and Hadiya knows Billz
 * intimately. This adapter is a thin cover that lets the same screen show
 * Billz's state and switch it on and off.
 *
 * The one thing worth stating plainly is where the credential is. Billz is the
 * shop's system of record and its token is the deployment's, set in the
 * environment, shared by everyone in the company — so this adapter never asks
 * for a secret and never stores one. Connecting Billz means "use it for my
 * account"; it does not mean handing Hadiya a key it did not already hold.
 */
export const billzProvider: IntegrationProviderAdapter = {
  info: {
    provider: 'billz',
    type: 'native',
    label: 'Billz',
    description:
      'The shop itself — catalogue, till, stock, customers. Hadiya reads it live and never writes to it.',
    available: config.integrations.billz.configured,
    unavailableReason: config.integrations.billz.configured
      ? null
      : 'This deployment has no Billz token configured.',
    authMethods: [],
    requiresServerUrl: false,
    // The token is the deployment's, not the person's.
    requiresCredential: false,
  },

  prepare: (): ProviderSetupResult => {
    if (!config.integrations.billz.configured) {
      throw ApiError.badRequest(
        'Billz is not configured for this deployment; ask an administrator to set its token.',
      );
    }

    return {
      patch: {
        credentialSource: 'environment',
        // The host, so the screen can show which Billz this is. Never the token.
        metadata: { baseUrl: config.integrations.billz.baseUrl },
      },
      secret: null,
    };
  },

  checkHealth: async (_actor: AuthenticatedUser, integration): Promise<IntegrationHealth> => {
    const startedAt = Date.now();
    const probe = await checkBillzConnection();
    const healthy = probe.connected && integration.enabled;

    return {
      // A switched-off integration reports `disabled` even when Billz is
      // perfectly healthy, because that is the state the person is in and the
      // one the screen has to explain.
      status: !integration.enabled ? 'disabled' : probe.connected ? 'connected' : 'error',
      healthy,
      message: probe.connected
        ? 'Billz answered.'
        : // The module's own normalised reason, which is written for a person
          // and contains no credential.
          (probe.error ?? 'Billz did not answer.'),
      toolCount: BILLZ_CAPABILITIES.length,
      server: { name: 'Billz', version: 'v2' },
      checkedAt: new Date().toISOString(),
      latencyMs: Date.now() - startedAt,
    };
  },
};
