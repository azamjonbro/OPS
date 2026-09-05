import type { IntegrationProvider, IntegrationProviderInfo } from '@hadiya/shared';

import { ApiError } from '../../../core/http/api-error.js';
import { billzProvider } from './billz.provider.js';
import { mcpProvider } from './mcp.provider.js';
import { notionProvider } from './notion.provider.js';
import type { IntegrationProviderAdapter } from './provider.types.js';

/**
 * Every provider Hadiya can connect to.
 *
 * This map is the extension point. A new native integration is a new adapter
 * file and one line here: the model stores it, the service manages it, the
 * catalogue endpoint offers it and the screen renders it, because none of those
 * knows any provider by name.
 *
 * The order is the order the "add integration" screen shows, which is why the
 * two Hadiya vouches for come before the one it does not.
 */
const ADAPTERS: Record<IntegrationProvider, IntegrationProviderAdapter> = {
  billz: billzProvider,
  notion: notionProvider,
  custom_mcp: mcpProvider,
};

export const getProviderAdapter = (provider: IntegrationProvider): IntegrationProviderAdapter => {
  const adapter = ADAPTERS[provider];

  if (!adapter) {
    // Unreachable through the API — the request schema is built from the same
    // list — so this catches a provider added to the enum and not to the map.
    throw ApiError.badRequest(`Hadiya does not know the provider "${provider}".`);
  }

  return adapter;
};

/**
 * The catalogue, rebuilt on each call.
 *
 * Not cached: `available` depends on configuration a deployment can change
 * between requests (an encryption key, a Billz token), and a stale "not
 * available" on a screen somebody is looking at is worth more than the
 * microseconds.
 */
export const listProviderCatalogue = (): IntegrationProviderInfo[] =>
  Object.values(ADAPTERS).map((adapter) => ({ ...adapter.info }));

export type { IntegrationProviderAdapter, ProviderSetupInput } from './provider.types.js';
export { billzProvider } from './billz.provider.js';
export { notionProvider } from './notion.provider.js';
export { mcpProvider } from './mcp.provider.js';
export { getNotionIdentity, readNotionPage, searchNotion } from './notion-client.js';
export { withOptionalSecret } from './provider-secret.js';
