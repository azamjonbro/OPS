import type {
  IntegrationHealth,
  IntegrationProviderInfo,
  McpAuthMethod,
  AuthenticatedUser,
} from '@hadiya/shared';

import type { IntegrationDocument } from '../integration.model.js';

/**
 * What every integration provider must be able to answer.
 *
 * This interface is the extensibility promise the hub makes. Adding Shopify or
 * Google Calendar next year should mean writing one adapter and adding it to
 * the catalogue in `providers/index.ts` — not touching the model, the service,
 * the routes, the tool registry or the agent, none of which mention a provider
 * by name.
 *
 * Two kinds of provider implement it. Native ones (Billz, Notion) know their
 * service and expose a fixed set of capabilities Hadiya wrote. The MCP adapter
 * knows only the protocol, and the tools come from whatever the user connected
 * to. The hub does not care which it is holding.
 */

/** What a person supplied when creating or updating the integration. */
export interface ProviderSetupInput {
  name: string;
  description?: string | null;
  /** MCP only. */
  serverUrl?: string | undefined;
  transport?: 'http' | 'sse' | undefined;
  authMethod?: McpAuthMethod | undefined;
  authHeaderName?: string | null | undefined;
  /** The secret, present only on the request that sets it. Never stored here. */
  secret?: string | undefined;
  /** Non-sensitive provider settings. */
  options?: Record<string, unknown> | undefined;
}

/** What an adapter decides should be written when an integration is created. */
export interface ProviderSetupResult {
  /** Fields the adapter owns; the service writes them with the common ones. */
  patch: Partial<
    Pick<
      IntegrationDocument,
      | 'serverUrl'
      | 'transport'
      | 'authMethod'
      | 'authHeaderName'
      | 'credentialSource'
      | 'options'
      | 'metadata'
    >
  >;
  /** A secret to encrypt, or `null` when the provider needs none. */
  secret: string | null;
}

export interface IntegrationProviderAdapter {
  /** Static description for the "add integration" catalogue. */
  readonly info: IntegrationProviderInfo;

  /**
   * Validates what a person typed and says what should be stored.
   *
   * Throws an `ApiError` for anything wrong, so a bad server URL is a 400 on
   * the form rather than a connection failure a minute later.
   */
  prepare: (input: ProviderSetupInput, existing?: IntegrationDocument) => ProviderSetupResult;

  /**
   * Proves the connection works, without changing anything on the far side.
   *
   * A health check may authenticate, read an identity and list what is on
   * offer. It may never call a business tool: "test connection" must be safe to
   * press, and a provider that sent an invoice to prove it could would be worse
   * than no test at all.
   */
  checkHealth: (
    actor: AuthenticatedUser,
    integration: IntegrationDocument,
  ) => Promise<IntegrationHealth>;

  /**
   * Re-reads what the provider can do, for providers whose tools are dynamic.
   *
   * Native providers leave this undefined: their capabilities are compiled in,
   * so there is nothing to discover. Only MCP implements it.
   */
  discoverTools?: (
    actor: AuthenticatedUser,
    integration: IntegrationDocument,
  ) => Promise<{ tools: import('../mcp/mcp-tool-schema.js').ValidatedMcpTool[] }>;
}
