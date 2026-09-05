import {
  isNativeProvider,
  type Integration,
  type IntegrationAuditEntry,
  type IntegrationDetail,
  type McpIntegrationConfig,
  type McpTool,
  type NativeIntegrationConfig,
} from '@hadiya/shared';

import type { IntegrationAuditDocument } from './integration-audit.model.js';
import type { IntegrationDocument, McpToolSubdocument } from './integration.model.js';

/**
 * The one place a stored integration becomes something a client may see.
 *
 * Every response in this module goes through here, and it is written as a
 * construction rather than a redaction: the view is built field by field from
 * the document, so a field added to the model in future is absent from the API
 * until somebody adds it here on purpose. A redaction — spread the document,
 * delete the dangerous keys — has the opposite default, and the day a
 * `refreshToken` field appears is the day it ships to every browser.
 *
 * There is no credential to omit here in any case: secrets live in a different
 * collection entirely. `hasCredentials` is the whole of what a client learns —
 * whether a token exists, never anything about it.
 */

const toIsoOrNull = (value: Date | null | undefined): string | null =>
  value ? value.toISOString() : null;

const toMcpToolView = (tool: McpToolSubdocument): McpTool => ({
  name: tool.name,
  description: tool.description,
  inputSchema: tool.inputSchema,
  risk: tool.risk,
  permission: tool.permission,
  discoveredAt: tool.discoveredAt.toISOString(),
  permissionSetAt: toIsoOrNull(tool.permissionSetAt),
});

/**
 * The safe half of an integration's configuration.
 *
 * For MCP: where the server is, how Hadiya speaks to it, and which auth method
 * was chosen — but never the token, and for header auth the header's *name*
 * only. A person needs to recognise their connection; nobody needs the material
 * that would let them use it.
 */
const toConfig = (
  document: IntegrationDocument,
): McpIntegrationConfig | NativeIntegrationConfig => {
  if (document.type === 'mcp') {
    return {
      serverUrl: document.serverUrl ?? '',
      transport: document.transport ?? 'http',
      authMethod: document.authMethod ?? 'none',
      authHeaderName: document.authHeaderName,
    };
  }

  return {
    credentialSource: document.credentialSource === 'environment' ? 'environment' : 'stored',
    options: document.options,
  };
};

export const toIntegrationView = (
  document: IntegrationDocument,
  hasCredentials: boolean,
): Integration => ({
  id: String(document._id),
  user: String(document.user),
  name: document.name,
  description: document.description,
  type: document.type,
  provider: document.provider,
  status: document.status,
  enabled: document.enabled,
  config: toConfig(document),
  hasCredentials,
  metadata: document.metadata,
  lastConnectedAt: toIsoOrNull(document.lastConnectedAt),
  lastErrorAt: toIsoOrNull(document.lastErrorAt),
  // Already normalised by whoever stored it: `integration.connect.service.ts`
  // only ever writes an `McpError.safeMessage` here.
  lastError: document.lastError,
  createdAt: document.createdAt.toISOString(),
  updatedAt: document.updatedAt.toISOString(),
});

/**
 * The detail view, which adds the tools.
 *
 * A native integration has no discovered tools — its capabilities are compiled
 * in — so the list is empty rather than absent, and the screen renders the
 * provider's own description instead of a permission table.
 */
export const toIntegrationDetailView = (
  document: IntegrationDocument,
  hasCredentials: boolean,
): IntegrationDetail => ({
  ...toIntegrationView(document, hasCredentials),
  tools: isNativeProvider(document.provider) ? [] : document.tools.map(toMcpToolView),
  toolsRefreshedAt: toIsoOrNull(document.toolsRefreshedAt),
});

export const toAuditEntryView = (document: IntegrationAuditDocument): IntegrationAuditEntry => ({
  id: String(document._id),
  user: String(document.user),
  integration: document.integration ? String(document.integration) : null,
  integrationName: document.integrationName,
  provider: document.provider,
  action: document.action,
  tool: document.tool,
  success: document.success,
  metadata: document.metadata,
  createdAt: document.createdAt.toISOString(),
  updatedAt: document.updatedAt.toISOString(),
});
