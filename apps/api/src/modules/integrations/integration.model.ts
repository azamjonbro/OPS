import {
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
  INTEGRATION_TYPES,
  MCP_AUTH_METHODS,
  MCP_TOOL_PERMISSIONS,
  MCP_TOOL_RISKS,
  MCP_TRANSPORTS,
  type IntegrationProvider,
  type IntegrationStatus,
  type IntegrationType,
  type McpAuthMethod,
  type McpToolPermission,
  type McpToolRisk,
  type McpTransport,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One tool an MCP server advertised, as Hadiya stores it.
 *
 * Embedded rather than given its own collection: tools have no life apart from
 * the integration that discovered them, they are always read together, and
 * deleting the integration must take them with it. A subdocument gets all three
 * for free.
 *
 * Everything except `permission` is the server's claim about itself, kept only
 * after `mcp-tool-schema.ts` has validated and truncated it. `permission` is
 * Hadiya's answer, and it is the only field that gates anything.
 */
export interface McpToolSubdocument {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: McpToolRisk;
  permission: McpToolPermission;
  discoveredAt: Date;
  /** Set when a person moved the permission off its default. */
  permissionSetAt: Date | null;
}

const mcpToolSchema = new Schema<McpToolSubdocument>(
  {
    name: { type: String, required: true, trim: true, maxlength: 96 },
    description: { type: String, required: true, default: '', maxlength: 1_000 },
    inputSchema: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
    risk: { type: String, required: true, enum: MCP_TOOL_RISKS, default: 'unknown' },
    permission: {
      type: String,
      required: true,
      enum: MCP_TOOL_PERMISSIONS,
      // Chosen at discovery from the tool's risk; this fallback is the safe one
      // for a row written any other way.
      default: 'requires_confirmation',
    },
    discoveredAt: { type: Date, required: true, default: () => new Date() },
    permissionSetAt: { type: Date, default: null },
  },
  { _id: false },
);

/**
 * A connection between one account and something outside Hadiya.
 *
 * The shape is deliberately loose where the future is: `config` and `metadata`
 * are free-form, so a native provider added next year needs a new adapter and
 * not a migration. It is deliberately strict where safety is: type, provider,
 * status and every tool permission are enumerations, so no adapter can invent a
 * state the authorization checks have never heard of.
 *
 * What is *not* here is the credential. It lives in `IntegrationCredential`,
 * encrypted, in its own collection — so the document a list endpoint reads,
 * serialises and logs cannot contain a secret even by mistake.
 */
export interface IntegrationDocument {
  _id: Types.ObjectId;
  /** Owner. Every query in the service filters on this; it is the tenancy. */
  user: Types.ObjectId;
  name: string;
  description: string | null;
  type: IntegrationType;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  /** A person's switch. Kept apart from `status` so repairing does not re-enable. */
  enabled: boolean;

  /** MCP only: where the server is and how to speak to it. */
  serverUrl: string | null;
  transport: McpTransport | null;
  authMethod: McpAuthMethod | null;
  /** Header name for `header` auth. The value is a secret and is not here. */
  authHeaderName: string | null;

  /** Native only: whether the secret is the deployment's or this person's. */
  credentialSource: 'environment' | 'stored' | 'none';
  /** Non-sensitive provider settings; never interpreted by shared code. */
  options: Record<string, unknown>;
  /** What the far side says about itself: server name, version, tool counts. */
  metadata: Record<string, unknown>;

  tools: McpToolSubdocument[];
  toolsRefreshedAt: Date | null;

  lastConnectedAt: Date | null;
  lastErrorAt: Date | null;
  /** Already normalised for a person; never a stack trace or a raw response. */
  lastError: string | null;

  createdAt: Date;
  updatedAt: Date;
}

const integrationSchema = createSchema<IntegrationDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true, maxlength: 80 },
  description: { type: String, default: null, trim: true, maxlength: 500 },
  type: { type: String, required: true, enum: INTEGRATION_TYPES },
  provider: { type: String, required: true, enum: INTEGRATION_PROVIDERS },
  status: { type: String, required: true, enum: INTEGRATION_STATUSES, default: 'disconnected' },
  enabled: { type: Boolean, required: true, default: true },

  serverUrl: { type: String, default: null, trim: true, maxlength: 2_048 },
  transport: { type: String, default: null, enum: [...MCP_TRANSPORTS, null] },
  authMethod: { type: String, default: null, enum: [...MCP_AUTH_METHODS, null] },
  authHeaderName: { type: String, default: null, trim: true, maxlength: 128 },

  credentialSource: {
    type: String,
    required: true,
    enum: ['environment', 'stored', 'none'],
    default: 'none',
  },
  options: { type: Schema.Types.Mixed, required: true, default: () => ({}) },
  metadata: { type: Schema.Types.Mixed, required: true, default: () => ({}) },

  tools: { type: [mcpToolSchema], required: true, default: () => [] },
  toolsRefreshedAt: { type: Date, default: null },

  lastConnectedAt: { type: Date, default: null },
  lastErrorAt: { type: Date, default: null },
  lastError: { type: String, default: null, maxlength: 500 },
});

// The list every screen asks for: this account's integrations, newest first.
// Leading with `user` is what makes the tenancy filter an index seek rather
// than a scan, and it is the same field the authorization depends on.
integrationSchema.index({ user: 1, createdAt: -1 });

/**
 * One native provider per account.
 *
 * Two Billz connections for the same person would be two answers to "is Billz
 * connected?", and the agent would have to pick one. MCP servers are exempt —
 * connecting three of them is the entire point — so the index is partial rather
 * than a rule in application code that a second code path could forget.
 */
integrationSchema.index(
  { user: 1, provider: 1 },
  { unique: true, partialFilterExpression: { type: 'native' } },
);

export const IntegrationModel: Model<IntegrationDocument> = model<IntegrationDocument>(
  'Integration',
  integrationSchema,
);
