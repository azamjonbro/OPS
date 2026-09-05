/**
 * The vocabulary of the Integration Hub.
 *
 * Hadiya reaches outside itself in two ways, and the difference is worth a word
 * in the type system rather than a comment. A **native** integration is one
 * Hadiya was taught: somebody wrote a client, chose which operations are safe,
 * and shipped them. An **mcp** integration is one the user brought: a server
 * speaking the Model Context Protocol, whose tools Hadiya has never seen and
 * cannot vouch for.
 *
 * Everything else in this file follows from that distinction. The native side
 * needs a provider name; the untrusted side needs transports, permissions and a
 * risk vocabulary.
 */

export const INTEGRATION_TYPES = ['native', 'mcp'] as const;

export type IntegrationType = (typeof INTEGRATION_TYPES)[number];

/**
 * Who is on the other end.
 *
 * Native providers are added here as they are built; `custom_mcp` is the single
 * entry the whole MCP side shares, because what distinguishes one MCP server
 * from another is its URL, not a name Hadiya knows in advance.
 */
export const NATIVE_INTEGRATION_PROVIDERS = ['billz', 'notion'] as const;

export type NativeIntegrationProvider = (typeof NATIVE_INTEGRATION_PROVIDERS)[number];

export const INTEGRATION_PROVIDERS = [...NATIVE_INTEGRATION_PROVIDERS, 'custom_mcp'] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

export const isNativeProvider = (provider: string): provider is NativeIntegrationProvider =>
  (NATIVE_INTEGRATION_PROVIDERS as readonly string[]).includes(provider);

/**
 * Where an integration stands.
 *
 * `disabled` is a person's decision and `error` is the world's: an integration
 * somebody switched off should not nag, and one that broke should. Keeping them
 * apart is what lets the screen say the right thing and the agent make the same
 * call — only `connected` exposes tools.
 */
export const INTEGRATION_STATUSES = [
  'disconnected',
  'connecting',
  'connected',
  'error',
  'disabled',
] as const;

export type IntegrationStatus = (typeof INTEGRATION_STATUSES)[number];

/** The one status in which an integration's tools may be offered to the model. */
export const isIntegrationUsable = (status: IntegrationStatus, enabled: boolean): boolean =>
  enabled && status === 'connected';

/**
 * How Hadiya talks to an MCP server.
 *
 * Both are HTTP: `http` is the current Streamable HTTP transport, `sse` the
 * older server-sent-events one, kept because plenty of deployed servers still
 * speak only that. Stdio is deliberately absent — it means spawning a process
 * on the API host, and no multi-tenant server should run a command a user typed
 * into a form.
 */
export const MCP_TRANSPORTS = ['http', 'sse'] as const;

export type McpTransport = (typeof MCP_TRANSPORTS)[number];

/**
 * How Hadiya proves who it is to an MCP server.
 *
 * Only what is actually implemented is listed. OAuth is not here because it is
 * not built, and offering a method that cannot complete is worse than offering
 * none: it produces an integration stuck at "authentication required" forever.
 */
export const MCP_AUTH_METHODS = ['none', 'bearer', 'header'] as const;

export type McpAuthMethod = (typeof MCP_AUTH_METHODS)[number];

/**
 * What the model is allowed to do with a discovered tool.
 *
 * Four states rather than a boolean, because "the AI may not call this" has
 * three genuinely different meanings. `disabled` is off for now. `blocked` is
 * off on purpose and should stay off. `requires_confirmation` is the
 * interesting one: the tool is useful, and a person decides each time.
 *
 * Nothing is `enabled` by discovery alone — see `MCP_TOOL_RISKS`.
 */
export const MCP_TOOL_PERMISSIONS = [
  'enabled',
  'requires_confirmation',
  'disabled',
  'blocked',
] as const;

export type McpToolPermission = (typeof MCP_TOOL_PERMISSIONS)[number];

/** Permissions under which a tool is offered to the model at all. */
export const CALLABLE_MCP_TOOL_PERMISSIONS = ['enabled', 'requires_confirmation'] as const;

export const isCallablePermission = (permission: McpToolPermission): boolean =>
  (CALLABLE_MCP_TOOL_PERMISSIONS as readonly string[]).includes(permission);

/**
 * How much damage a tool could do, as Hadiya reads it.
 *
 * A guess, and treated as one. It comes from the server's own annotations where
 * they exist and from the verb in the tool's name where they do not, and both
 * are supplied by the very server being judged. So the classification only ever
 * *lowers* trust: it can mark something destructive, never wave something
 * through. What it earns is a sensible default permission, not a decision.
 */
export const MCP_TOOL_RISKS = ['read', 'write', 'destructive', 'unknown'] as const;

export type McpToolRisk = (typeof MCP_TOOL_RISKS)[number];

/**
 * The default permission for a freshly discovered tool.
 *
 * Reads run. Everything else asks first, including anything that could not be
 * classified — a tool Hadiya does not understand is exactly the tool a person
 * should see before it runs. Nothing is blocked by default, because blocking is
 * a judgement about *this* server that only its owner can make.
 */
export const defaultPermissionForRisk = (risk: McpToolRisk): McpToolPermission =>
  risk === 'read' ? 'enabled' : 'requires_confirmation';

/**
 * Verbs that make a tool destructive whatever its annotations claim.
 *
 * Deliberately matched as whole words against the tool's name *and* its
 * description, and deliberately conservative: a false positive costs one extra
 * confirmation click, a false negative costs a customer record.
 */
export const DESTRUCTIVE_TOOL_VERBS = [
  'delete',
  'destroy',
  'drop',
  'erase',
  'purge',
  'remove',
  'reset',
  'revoke',
  'truncate',
  'wipe',
] as const;

/** Events worth keeping a record of. */
export const INTEGRATION_AUDIT_ACTIONS = [
  'integration_created',
  'integration_updated',
  'integration_deleted',
  'integration_connected',
  'integration_disconnected',
  'integration_tested',
  'mcp_tools_discovered',
  'mcp_tool_permission_changed',
  'mcp_tool_executed',
  'mcp_tool_failed',
  'mcp_tool_blocked',
  'mcp_confirmation_requested',
] as const;

export type IntegrationAuditAction = (typeof INTEGRATION_AUDIT_ACTIONS)[number];

/**
 * Bounds on anything an external server can grow without limit.
 *
 * Every one of these exists because the other side of the connection is not
 * ours: a server can advertise ten thousand tools, name one of them a kilobyte
 * long, or answer a call with a megabyte of text aimed at the context window.
 */
export const MCP_LIMITS = {
  /** Tools kept from one server. Discovery stops here rather than failing. */
  maxTools: 128,
  maxToolNameLength: 96,
  maxToolDescriptionLength: 1_000,
  /** Serialised input schema, in bytes. */
  maxToolSchemaBytes: 32_768,
  /** Text of one tool result handed back to the model. */
  maxToolResultLength: 8_000,
  /** Tool calls one account may make across all its MCP servers, per minute. */
  callsPerMinutePerUser: 60,
  /** Tool calls one integration may serve per minute. */
  callsPerMinutePerIntegration: 30,
  /** Calls in flight at once for one account. */
  maxConcurrentCallsPerUser: 4,
} as const;

/** How long discovered tool metadata is trusted before a refresh is due. */
export const MCP_TOOL_CACHE_TTL_MS = 15 * 60 * 1_000;

/**
 * The registry name an MCP tool is exposed under.
 *
 * Namespaced by integration id, not by server name: two people may both call
 * their CRM "crm", and the id is the only part that cannot collide. It is also
 * what makes provenance recoverable from the name alone, which is what the
 * audit log and the ownership check both need.
 */
export const mcpToolRegistryName = (integrationId: string, toolName: string): string =>
  `mcp.${integrationId}.${toolName}`;

/** The inverse, for a name that came back from a model. */
export const parseMcpToolRegistryName = (
  name: string,
): { integrationId: string; toolName: string } | null => {
  const match = /^mcp\.([0-9a-fA-F]{24})\.(.+)$/.exec(name);

  return match?.[1] && match[2] ? { integrationId: match[1], toolName: match[2] } : null;
};
