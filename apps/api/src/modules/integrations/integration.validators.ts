import {
  INTEGRATION_AUDIT_ACTIONS,
  INTEGRATION_PROVIDERS,
  INTEGRATION_STATUSES,
  MCP_AUTH_METHODS,
  MCP_TOOL_PERMISSIONS,
  MCP_TRANSPORTS,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * What a client may send.
 *
 * The interesting field is `secret`, and what is interesting is that it appears
 * on the way *in* and never on the way out. There is no response schema
 * anywhere in this module that contains it, no update endpoint that echoes it
 * back, and no "reveal" route — a token entered here can be replaced but never
 * read, which is the only arrangement under which "Hadiya never shows your
 * credentials" is a true sentence rather than a UI decision.
 */

const nameSchema = z.string().trim().min(1).max(80);
const descriptionSchema = z.string().trim().max(500).nullable();

/**
 * A credential, bounded but otherwise unexamined.
 *
 * Deliberately not pattern-matched: tokens differ per provider, and a regex
 * that rejected a valid one would be a support ticket with no upside. The
 * provider adapter applies whatever check it can, and the real verdict comes
 * from the server on the first connection.
 */
const secretSchema = z.string().min(1).max(4_096);

/** Checked properly by `parseMcpServerUrl`; this only bounds the field. */
const serverUrlSchema = z.string().trim().min(1).max(2_048);

export const createIntegrationSchema = z
  .object({
    provider: z.enum(INTEGRATION_PROVIDERS),
    name: nameSchema,
    description: descriptionSchema.optional(),
    serverUrl: serverUrlSchema.optional(),
    transport: z.enum(MCP_TRANSPORTS).optional(),
    authMethod: z.enum(MCP_AUTH_METHODS).optional(),
    authHeaderName: z.string().trim().max(64).nullable().optional(),
    secret: secretSchema.optional(),
  })
  .superRefine((value, ctx) => {
    // The adapter enforces the provider's real requirements; this catches the
    // one combination that is nonsense for every provider, so the message names
    // the field rather than arriving as a generic provider error.
    if (value.provider !== 'custom_mcp' && value.serverUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['serverUrl'],
        message: 'Only a custom MCP integration has a server address',
      });
    }
  });

export const updateIntegrationSchema = z
  .object({
    name: nameSchema.optional(),
    description: descriptionSchema.optional(),
    enabled: z.boolean().optional(),
    serverUrl: serverUrlSchema.optional(),
    transport: z.enum(MCP_TRANSPORTS).optional(),
    authMethod: z.enum(MCP_AUTH_METHODS).optional(),
    authHeaderName: z.string().trim().max(64).nullable().optional(),
    secret: secretSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'There is nothing to update',
  });

export const listIntegrationsQuerySchema = paginationQuerySchema.extend({
  provider: z.enum(INTEGRATION_PROVIDERS).optional(),
  status: z.enum(INTEGRATION_STATUSES).optional(),
});

export const integrationIdParamSchema = z.object({ id: objectIdSchema });

/**
 * The tool name in a path.
 *
 * Matches what `mcp-tool-schema.ts` allows through discovery, so a name that
 * could not have been stored cannot be asked about either.
 */
export const toolParamSchema = z.object({
  id: objectIdSchema,
  tool: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/, 'That is not a tool name'),
});

export const setToolPermissionSchema = z.object({
  permission: z.enum(MCP_TOOL_PERMISSIONS),
});

export const listAuditQuerySchema = paginationQuerySchema.extend({
  integrationId: objectIdSchema.optional(),
  action: z.enum(INTEGRATION_AUDIT_ACTIONS).optional(),
});
