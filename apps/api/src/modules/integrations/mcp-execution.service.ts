import {
  isCallablePermission,
  isIntegrationUsable,
  type AuthenticatedUser,
  type McpAuthMethod,
  type McpToolPermission,
  type McpTransport,
} from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { createLogger } from '../../core/logger/logger.js';
import { CREDENTIAL_PURPOSE, hasSecret } from './credential.service.js';
import { recordIntegrationEvent } from './integration.audit.service.js';
import {
  IntegrationModel,
  type IntegrationDocument,
  type McpToolSubdocument,
} from './integration.model.js';
import { withMcpConnection } from './mcp/mcp-client.js';
import { McpError } from './mcp/mcp-error.js';
import { acquireToolSlot } from './mcp/mcp-guard.js';
import { buildArgumentValidator } from './mcp/mcp-tool-schema.js';
import { withOptionalSecret } from './providers/provider-secret.js';

const log = createLogger('mcp-execution');

/**
 * The gate every MCP tool call passes through.
 *
 * This is the most safety-critical file in the hub, because it is the only one
 * an untrusted server's tools can actually reach through. Five things are
 * checked here, in this order, and none of them is delegated upward:
 *
 *  1. **Ownership.** The integration is fetched by id *and* actor. A call for
 *     somebody else's integration finds nothing.
 *  2. **Availability.** Enabled and connected. A disabled, disconnected or
 *     failing integration cannot run anything.
 *  3. **Permission.** Re-read from the database now, not taken from whatever
 *     the tool registry was built with. A registry is assembled per turn and a
 *     turn can outlive a person's decision to block something; the stored
 *     permission is the truth at the moment of the call.
 *  4. **Arguments.** Validated against the tool's own declared schema before
 *     they leave the process.
 *  5. **Budget.** A slot from the rate and concurrency guard.
 *
 * Confirmation is deliberately *not* here: the tool registry already enforces
 * it for every tool in Hadiya, and a second mechanism would be a second thing
 * to get wrong. What this file does is tell the registry which tools need it.
 */

export interface McpExecutionRequest {
  actor: AuthenticatedUser;
  integrationId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface McpExecutionResult {
  text: string;
  /** The server's own verdict: the tool ran and reported a problem. */
  isError: boolean;
  truncated: boolean;
  durationMs: number;
}

/** A refusal that is the caller's answer rather than an exception. */
export class McpToolNotAllowedError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(reason);
    this.name = 'McpToolNotAllowedError';
    this.reason = reason;
  }
}

interface ResolvedTool {
  integration: IntegrationDocument;
  tool: McpToolSubdocument;
}

/**
 * Finds the integration and the tool, refusing unless both are usable.
 *
 * Exported because the tool registry needs the same answer before it offers a
 * tool to the model, and having two functions decide "may this run?" is how the
 * two come to disagree.
 */
export const resolveCallableTool = async (
  actor: AuthenticatedUser,
  integrationId: string,
  toolName: string,
): Promise<ResolvedTool> => {
  // Ownership is the filter. A different account's integration is not found,
  // and "not found" is also the right thing to say about it.
  const integration = await IntegrationModel.findOne({
    _id: toObjectId(integrationId),
    user: toObjectId(actor.id),
  })
    .lean<IntegrationDocument | null>()
    .exec();

  if (!integration) {
    throw new McpToolNotAllowedError('That integration is not available.');
  }

  if (!isIntegrationUsable(integration.status, integration.enabled)) {
    throw new McpToolNotAllowedError(
      integration.enabled
        ? 'That integration is not connected.'
        : 'That integration is switched off.',
    );
  }

  const tool = integration.tools.find((candidate) => candidate.name === toolName);

  if (!tool) {
    // Either the model invented a name or the server withdrew the tool since
    // discovery. Both are "no".
    throw new McpToolNotAllowedError('That tool is not available on this integration.');
  }

  if (!isCallablePermission(tool.permission)) {
    throw new McpToolNotAllowedError(
      tool.permission === 'blocked'
        ? 'That tool is blocked and cannot be run.'
        : 'That tool is switched off.',
    );
  }

  return { integration, tool };
};

/** The permission a tool currently holds, for the registry's confirmation flag. */
export const permissionOf = (tool: McpToolSubdocument): McpToolPermission => tool.permission;

/**
 * Runs one tool against one server.
 *
 * Everything protective has already been decided by the time the connection is
 * opened, which is the point: the network call is the last thing that happens,
 * not the first.
 */
export const executeMcpTool = async (request: McpExecutionRequest): Promise<McpExecutionResult> => {
  const startedAt = Date.now();
  const { integration, tool } = await resolveCallableTool(
    request.actor,
    request.integrationId,
    request.toolName,
  );

  // The model wrote these arguments and they are about to be sent to somebody
  // else's server, so they are checked against the schema that server declared.
  const parsed = buildArgumentValidator(tool.inputSchema).safeParse(request.args);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');

    throw new McpToolNotAllowedError(
      `Those arguments do not match what the tool expects: ${issues}`,
    );
  }

  const release = acquireToolSlot({
    userId: request.actor.id,
    integrationId: request.integrationId,
  });

  const authMethod = (integration.authMethod as McpAuthMethod | null) ?? 'none';

  try {
    const result = await withOptionalSecret(
      {
        integrationId: request.integrationId,
        userId: request.actor.id,
        needsSecret:
          authMethod !== 'none' &&
          (await hasSecret(request.integrationId, CREDENTIAL_PURPOSE.token)),
      },
      (secret) =>
        withMcpConnection(
          {
            serverUrl: integration.serverUrl ?? '',
            transport: (integration.transport as McpTransport | null) ?? 'http',
            authMethod,
            authHeaderName: integration.authHeaderName,
            secret,
          },
          (client) => client.callTool(tool.name, parsed.data as Record<string, unknown>),
        ),
    );

    const durationMs = Date.now() - startedAt;

    await recordIntegrationEvent({
      actor: request.actor,
      integrationId: request.integrationId,
      integrationName: integration.name,
      provider: integration.provider,
      action: result.isError ? 'mcp_tool_failed' : 'mcp_tool_executed',
      tool: tool.name,
      success: !result.isError,
      // Lengths and durations only. Never the arguments, never the result: an
      // audit trail that accumulated customer records would be a second copy of
      // the data it exists to police.
      metadata: {
        durationMs,
        resultLength: result.text.length,
        truncated: result.truncated,
        permission: tool.permission,
        risk: tool.risk,
      },
    });

    return { ...result, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const safe = error instanceof McpError ? error.safeMessage : 'The tool did not complete.';

    log.warn(
      { integrationId: request.integrationId, tool: tool.name, err: error },
      'MCP tool execution failed',
    );

    await recordIntegrationEvent({
      actor: request.actor,
      integrationId: request.integrationId,
      integrationName: integration.name,
      provider: integration.provider,
      action: 'mcp_tool_failed',
      tool: tool.name,
      success: false,
      metadata: { durationMs, reason: safe },
    });

    throw error instanceof McpError ? error : new McpError('tool_failed', safe, { cause: error });
  } finally {
    release();
  }
};

/** Records that the model asked a person before running something. */
export const recordConfirmationRequest = async (
  actor: AuthenticatedUser,
  integration: Pick<IntegrationDocument, 'name' | 'provider'>,
  integrationId: string,
  toolName: string,
): Promise<void> => {
  await recordIntegrationEvent({
    actor,
    integrationId,
    integrationName: integration.name,
    provider: integration.provider,
    action: 'mcp_confirmation_requested',
    tool: toolName,
    success: true,
  });
};

/** Records a refusal, which is the event worth knowing about. */
export const recordBlockedCall = async (
  actor: AuthenticatedUser,
  params: { integrationId: string; integrationName: string; toolName: string; reason: string },
): Promise<void> => {
  await recordIntegrationEvent({
    actor,
    integrationId: params.integrationId,
    integrationName: params.integrationName,
    // The provider is known from the name's namespace; a blocked call may not
    // have resolved an integration at all, so the safe constant is used.
    provider: 'custom_mcp',
    action: 'mcp_tool_blocked',
    tool: params.toolName,
    success: false,
    metadata: { reason: params.reason },
  });
};
