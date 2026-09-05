/**
 * The Integration Hub's public surface.
 *
 * What crosses this boundary is deliberately narrow. The AI tools need to know
 * which integrations are usable and how to run one of their tools; the API
 * needs the router. Nothing else — no model, no credential function, no MCP
 * client — is exported, so the only way to reach a stored secret from outside
 * this directory is not to.
 */
export { integrationRouter } from './integration.routes.js';

export {
  IntegrationModel,
  type IntegrationDocument,
  type McpToolSubdocument,
} from './integration.model.js';
export { IntegrationCredentialModel } from './integration-credential.model.js';
export { IntegrationAuditModel, type IntegrationAuditDocument } from './integration-audit.model.js';

export { listUsableIntegrations, getOwnedIntegration } from './integration.service.js';
export {
  connectIntegration,
  disconnectIntegration,
  refreshIntegrationTools,
  testIntegration,
} from './integration.connect.service.js';

export {
  executeMcpTool,
  McpToolNotAllowedError,
  recordBlockedCall,
  recordConfirmationRequest,
  resolveCallableTool,
  type McpExecutionResult,
} from './mcp-execution.service.js';

export { McpError, isMcpError } from './mcp/mcp-error.js';
export {
  setMcpClientFactory,
  type McpClient,
  type McpConnectionSettings,
} from './mcp/mcp-client.js';
export { resetMcpGuards } from './mcp/mcp-guard.js';
export { resetSecretBox } from './credential.service.js';

export { getNotionIdentity, readNotionPage, searchNotion } from './providers/notion-client.js';
export { withOptionalSecret } from './providers/provider-secret.js';
export { CREDENTIAL_PURPOSE, hasSecret, withSecret } from './credential.service.js';

export { toIntegrationDetailView, toIntegrationView } from './integration.mapper.js';
export { recordIntegrationEvent } from './integration.audit.service.js';
