import { MCP_LIMITS, type McpAuthMethod, type McpTransport } from '@hadiya/shared';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';

import { config } from '../../../config/index.js';
import { createLogger } from '../../../core/logger/logger.js';
import { McpError, toMcpError } from './mcp-error.js';
import {
  sanitiseExternalText,
  validateDiscoveredTools,
  type ValidatedMcpTool,
} from './mcp-tool-schema.js';
import { describeServerUrl, parseMcpServerUrl } from './mcp-url.js';

const log = createLogger('mcp-client');

/**
 * Everything Hadiya knows about the Model Context Protocol, in one file.
 *
 * Above this line nobody has heard of MCP: the tool registry sees ordinary
 * tools, the agent sees a registry, the controllers see an integration. That
 * separation is what lets the protocol move — a transport deprecated, an SDK
 * upgraded — without touching the agent, and it is why the interface below is
 * written in Hadiya's vocabulary rather than the SDK's.
 *
 * The real protocol is used, not a re-implementation of it: this wraps the
 * official SDK's client and its two HTTP transports. What is added on top is
 * everything the SDK deliberately leaves to the caller — a URL that has been
 * checked, a deadline on every operation, discovered metadata that has been
 * validated, results that have been bounded, and failures normalised into
 * something safe to show a person.
 */

export interface McpConnectionSettings {
  serverUrl: string;
  transport: McpTransport;
  authMethod: McpAuthMethod;
  /** Header name for `header` auth, e.g. `X-Api-Key`. */
  authHeaderName?: string | null;
  /** The secret itself, held only for the life of the connection. */
  secret?: string | null;
}

export interface McpServerInfo {
  name: string;
  version: string;
}

/**
 * One tool result, already made safe to hand to a model.
 *
 * `text` is bounded and stripped of anything invisible; `isError` is the
 * server's own verdict on its call, kept separate from a transport failure
 * because "the tool ran and said no" is a different thing from "the server
 * never answered", and the model should be told which.
 */
export interface McpToolCallResult {
  text: string;
  isError: boolean;
  /** True when the server's answer was longer than Hadiya will pass on. */
  truncated: boolean;
}

/**
 * What the rest of Hadiya may ask of an MCP server.
 *
 * The interface exists so tests can supply a double — no automated test in this
 * repository opens a socket to an MCP server — and so a second implementation
 * (a pooled client, a different SDK) can be dropped in whole.
 */
export interface McpClient {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  /** Server identity from the handshake; `null` before `connect`. */
  serverInfo: () => McpServerInfo | null;
  listTools: () => Promise<ValidatedMcpTool[]>;
  callTool: (name: string, args: Record<string, unknown>) => Promise<McpToolCallResult>;
}

/** How Hadiya introduces itself in the handshake. */
const CLIENT_INFO = { name: 'hadiya', version: '2.0.0' } as const;

/**
 * The headers that carry the credential.
 *
 * Built per connection and never stored. `bearer` and `header` are the two
 * methods Hadiya implements; `none` sends nothing, which is right for a server
 * that authenticates by URL secret or not at all.
 */
const authHeaders = (settings: McpConnectionSettings): Record<string, string> => {
  const secret = settings.secret?.trim();

  if (!secret || settings.authMethod === 'none') {
    return {};
  }

  if (settings.authMethod === 'bearer') {
    return { Authorization: `Bearer ${secret}` };
  }

  const name = settings.authHeaderName?.trim();

  return name ? { [name]: secret } : {};
};

/**
 * Runs an operation against a deadline.
 *
 * The SDK times out its own requests, but not the transport's initial connect,
 * and a server that accepts a socket and then says nothing would otherwise hold
 * a chat turn open indefinitely. Every path through this client is wrapped.
 */
const withDeadline = async <TResult>(
  operation: Promise<TResult>,
  timeoutMs: number,
): Promise<TResult> => {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new McpError('timeout')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Flattens a `CallToolResult` into the text a model can read.
 *
 * Only textual content survives. An MCP result may also carry images, audio and
 * embedded resources, and none of them belongs in a chat transcript that came
 * from a server Hadiya does not trust — a resource link in particular is a URL
 * the model might be persuaded to follow. They are counted and described rather
 * than passed on.
 */
const flattenContent = (content: unknown): { text: string; skipped: number } => {
  if (!Array.isArray(content)) {
    return { text: '', skipped: 0 };
  }

  const parts: string[] = [];
  let skipped = 0;

  for (const block of content) {
    const record = block as { type?: unknown; text?: unknown } | null;

    if (record && record.type === 'text' && typeof record.text === 'string') {
      parts.push(record.text);
    } else {
      skipped += 1;
    }
  }

  return { text: parts.join('\n'), skipped };
};

/** Builds the transport for the configured protocol. */
const createTransport = (
  settings: McpConnectionSettings,
  headers: Record<string, string>,
): Transport => {
  // Validated again here rather than trusted from the database: a row could
  // predate the rule, or have been written before the deployment tightened it.
  const url = parseMcpServerUrl(settings.serverUrl);
  const requestInit = { headers } satisfies RequestInit;

  return settings.transport === 'sse'
    ? new SSEClientTransport(url, { requestInit })
    : new StreamableHTTPClientTransport(url, { requestInit });
};

/**
 * A client for one MCP server, for the length of one operation.
 *
 * Deliberately not pooled or kept alive. A long-lived connection to a
 * user-supplied server would mean holding that user's decrypted credential in
 * memory indefinitely, and would give the far side a socket it could use to
 * push notifications at Hadiya between turns. Connecting per operation costs a
 * handshake and buys a much smaller blast radius.
 */
export const createMcpClient = (settings: McpConnectionSettings): McpClient => {
  const client = new Client(CLIENT_INFO, { capabilities: {} });
  const headers = authHeaders(settings);
  let transport: Transport | null = null;
  let connected = false;

  const requireConnected = (): void => {
    if (!connected) {
      throw new McpError('protocol', 'The connection to the server was not open.');
    }
  };

  return {
    connect: async () => {
      if (connected) {
        return;
      }

      try {
        transport = createTransport(settings, headers);

        // `connect` performs the MCP `initialize` exchange: capabilities are
        // negotiated and the server names itself before anything else is asked.
        await withDeadline(client.connect(transport), config.mcp.connectTimeoutMs);
        connected = true;
      } catch (error) {
        // The host, never the URL: a path or query could carry a secret a
        // person pasted into the address field.
        log.warn(
          { server: describeServerUrl(settings.serverUrl), err: error },
          'MCP connection failed',
        );

        await transport?.close().catch(() => undefined);
        transport = null;

        throw toMcpError(error);
      }
    },

    disconnect: async () => {
      connected = false;

      try {
        await client.close();
      } catch (error) {
        // Closing is best effort: the interesting failure already happened.
        log.debug({ err: error }, 'MCP client close failed');
      }

      transport = null;
    },

    serverInfo: () => {
      const version = client.getServerVersion();

      return version
        ? {
            // The server names itself, so its name is untrusted text like any
            // other and is bounded before it reaches a screen.
            name: sanitiseExternalText(version.name, 80) || 'unknown',
            version: sanitiseExternalText(String(version.version ?? ''), 40) || 'unknown',
          }
        : null;
    },

    listTools: async () => {
      requireConnected();

      try {
        const response = await withDeadline(
          client.listTools({}, { timeout: config.mcp.connectTimeoutMs }),
          config.mcp.connectTimeoutMs,
        );

        const outcome = validateDiscoveredTools(response.tools);

        if (outcome.rejected.length > 0) {
          log.info(
            { server: describeServerUrl(settings.serverUrl), rejected: outcome.rejected },
            'MCP tools were rejected during discovery',
          );
        }

        return outcome.tools;
      } catch (error) {
        throw toMcpError(error);
      }
    },

    callTool: async (name, args) => {
      requireConnected();

      try {
        const response = await withDeadline(
          client.callTool({ name, arguments: args }, undefined, {
            timeout: config.mcp.toolTimeoutMs,
          }),
          config.mcp.toolTimeoutMs,
        );

        const { text, skipped } = flattenContent(response.content);
        const cleaned = sanitiseExternalText(text, MCP_LIMITS.maxToolResultLength + 1);
        const truncated = cleaned.length > MCP_LIMITS.maxToolResultLength;

        return {
          text: truncated ? cleaned.slice(0, MCP_LIMITS.maxToolResultLength) : cleaned,
          isError: response.isError === true,
          truncated: truncated || skipped > 0,
        };
      } catch (error) {
        throw toMcpError(error);
      }
    },
  };
};

/**
 * How an `McpClient` is obtained.
 *
 * A seam rather than a direct call, so every test in this module runs against a
 * scripted server: nothing here ever opens a socket during `npm test`.
 */
export type McpClientFactory = (settings: McpConnectionSettings) => McpClient;

let factory: McpClientFactory = createMcpClient;

export const getMcpClientFactory = (): McpClientFactory => factory;

export const setMcpClientFactory = (next: McpClientFactory | null): void => {
  factory = next ?? createMcpClient;
};

/**
 * Opens a connection, does something with it, and closes it whatever happens.
 *
 * Every MCP operation in Hadiya goes through here, so there is one place a
 * connection can be leaked and it is written correctly once.
 */
export const withMcpConnection = async <TResult>(
  settings: McpConnectionSettings,
  use: (client: McpClient) => Promise<TResult>,
): Promise<TResult> => {
  const client = factory(settings);

  await client.connect();

  try {
    return await use(client);
  } finally {
    await client.disconnect();
  }
};
