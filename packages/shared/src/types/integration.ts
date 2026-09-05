import type {
  IntegrationAuditAction,
  IntegrationProvider,
  IntegrationStatus,
  IntegrationType,
  McpAuthMethod,
  McpToolPermission,
  McpToolRisk,
  McpTransport,
} from '../constants/integrations.js';
import type { Entity } from './entity.js';

/**
 * A connection between one account and something outside Hadiya.
 *
 * This is the shape a *client* receives, and what is missing from it is the
 * point: there is no credential here, no token, no header value, not even a
 * redacted stand-in. A secret lives encrypted in its own collection and is read
 * only by the code that makes the outbound call. Nothing that reaches this type
 * can reach a browser, a log line or a model.
 *
 * `config` is the safe half of the same idea — a server URL, a transport, a
 * chosen auth *method* — everything a person needs to recognise the connection
 * without any of what would let them use it.
 */
export interface Integration extends Entity {
  /** Owner. An integration is never visible or usable across accounts. */
  user: string;
  /** What the person called it, e.g. "My CRM". */
  name: string;
  description: string | null;
  type: IntegrationType;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** A person's switch, kept apart from `status` so a repair does not re-enable. */
  enabled: boolean;
  config: McpIntegrationConfig | NativeIntegrationConfig;
  /** Whether a secret is on file. Never the secret, and never a prefix of one. */
  hasCredentials: boolean;
  /** Free-form, non-sensitive: server name and version, tool counts. */
  metadata: Record<string, unknown>;
  /** ISO-8601 of the last successful handshake. */
  lastConnectedAt: string | null;
  /** ISO-8601 of the last failure. */
  lastErrorAt: string | null;
  /** Already normalised for a person to read; never a stack or a raw response. */
  lastError: string | null;
}

/**
 * How to reach a user's own MCP server.
 *
 * The auth *method* is here and the auth *material* is not, which is the
 * division the whole hub is built on: a client may see that a server expects a
 * bearer token, never what the token is.
 */
export interface McpIntegrationConfig {
  serverUrl: string;
  transport: McpTransport;
  authMethod: McpAuthMethod;
  /** Header name for `header` auth, e.g. `X-Api-Key`. The value is a secret. */
  authHeaderName: string | null;
}

/**
 * A native provider's settings.
 *
 * Deliberately near-empty. Native providers are configured by the code that
 * implements them; Billz in particular reads its credential from the
 * deployment's environment, which is why it can be connected without anybody
 * ever typing a secret into Hadiya.
 */
export interface NativeIntegrationConfig {
  /** `environment` for a deployment-wide credential, `stored` for a per-user one. */
  credentialSource: 'environment' | 'stored';
  /** Provider-specific, non-sensitive settings. */
  options?: Record<string, unknown>;
}

/**
 * One tool an MCP server said it has.
 *
 * Everything on it except `permission` came from the server and has been
 * validated and truncated on the way in; none of it is trusted. `permission` is
 * Hadiya's, and it is the only field that decides anything.
 */
export interface McpTool {
  name: string;
  /** The server's own words, sanitised. Shown to a person and to the model. */
  description: string;
  /** JSON Schema for the arguments, as the server declared it. */
  inputSchema: Record<string, unknown>;
  risk: McpToolRisk;
  permission: McpToolPermission;
  /** ISO-8601 of the discovery run that last saw this tool. */
  discoveredAt: string;
  /** Set when a person changed the permission away from its default. */
  permissionSetAt: string | null;
}

/** An integration with its discovered tools, for the detail screen. */
export interface IntegrationDetail extends Integration {
  tools: McpTool[];
  /** ISO-8601 of the last successful `listTools`. */
  toolsRefreshedAt: string | null;
}

/**
 * The answer to "does this actually work?".
 *
 * A test never calls a business tool — it completes the handshake and lists
 * what is on offer, which is the most that can be learned without changing
 * anything on the far side.
 */
export interface IntegrationHealth {
  status: IntegrationStatus;
  healthy: boolean;
  /** Safe, already-normalised text when it failed. */
  message: string;
  /** Tools the server advertised, when the provider has any. */
  toolCount: number;
  /** What the server calls itself, when it says. */
  server: { name: string; version: string } | null;
  /** ISO-8601. */
  checkedAt: string;
  latencyMs: number;
}

/** One line of the integration audit trail. */
export interface IntegrationAuditEntry extends Entity {
  user: string;
  /** Kept after the integration is deleted, so the trail survives it. */
  integration: string | null;
  integrationName: string;
  provider: IntegrationProvider;
  action: IntegrationAuditAction;
  /** MCP tool the action concerned, when it concerned one. */
  tool: string | null;
  success: boolean;
  /** Sanitised: counts, durations, normalised messages. Never arguments. */
  metadata: Record<string, unknown>;
}

/** What the "add integration" screen offers, described by the server. */
export interface IntegrationProviderInfo {
  provider: IntegrationProvider;
  type: IntegrationType;
  label: string;
  description: string;
  /** False when the deployment has not configured what this provider needs. */
  available: boolean;
  /** Why it is unavailable, for the disabled card's tooltip. */
  unavailableReason: string | null;
  /** Auth methods this provider can actually complete. */
  authMethods: McpAuthMethod[];
  /** Whether the person supplies a server URL. */
  requiresServerUrl: boolean;
  /** Whether the person supplies a secret. */
  requiresCredential: boolean;
}
