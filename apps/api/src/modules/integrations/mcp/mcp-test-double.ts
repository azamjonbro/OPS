import type { McpClient, McpClientFactory, McpConnectionSettings } from './mcp-client.js';
import type { McpError } from './mcp-error.js';
import { validateDiscoveredTools, type ValidatedMcpTool } from './mcp-tool-schema.js';

/**
 * A scripted MCP server, for tests.
 *
 * No automated test in this repository opens a socket to an MCP server. A real
 * one would make the suite depend on somebody else's uptime, and — much worse —
 * would mean the tests that matter most here could not be written at all: there
 * is no public server that will reliably return a malformed schema, hang past a
 * timeout, or answer a search with a prompt injection on demand. Those are
 * exactly the cases this file exists to produce.
 *
 * Raw tool definitions go through the same `validateDiscoveredTools` the real
 * client uses, so a test can hand over a deliberately broken tool and watch it
 * be rejected by the production code path rather than by the double.
 */
export interface ScriptedMcpServer {
  /** Tools as the server would advertise them, before validation. */
  tools?: unknown[];
  /** Answers per tool name. A function may throw to simulate a failure. */
  results?: Record<
    string,
    | string
    | { text: string; isError?: boolean }
    | ((args: Record<string, unknown>) => string | { text: string; isError?: boolean })
  >;
  /** What the server calls itself. */
  serverInfo?: { name: string; version: string } | null;
  /** Thrown by `connect`, for unreachable and authentication-failure tests. */
  connectError?: McpError;
  /** Thrown by `listTools`. */
  listError?: McpError;
  /** Milliseconds `callTool` waits before answering, for timeout tests. */
  callDelayMs?: number;
}

export interface ScriptedMcpRecorder {
  /** Every connection opened, in order, with the resolved auth header. */
  readonly connections: Array<{ settings: McpConnectionSettings }>;
  /** Every tool call made, in order. */
  readonly calls: Array<{ name: string; args: Record<string, unknown> }>;
  /** How many connections are open right now; must return to zero. */
  openConnections: number;
}

export interface ScriptedMcp {
  factory: McpClientFactory;
  recorder: ScriptedMcpRecorder;
}

const toResult = (
  script: ScriptedMcpServer,
  name: string,
  args: Record<string, unknown>,
): { text: string; isError: boolean } => {
  const answer = script.results?.[name];

  if (answer === undefined) {
    // A server that does not know the tool is a real case, and the SDK reports
    // it as a tool error rather than a transport one.
    return { text: `Unknown tool: ${name}`, isError: true };
  }

  const resolved = typeof answer === 'function' ? answer(args) : answer;

  return typeof resolved === 'string'
    ? { text: resolved, isError: false }
    : { text: resolved.text, isError: resolved.isError ?? false };
};

/**
 * Builds a client factory that answers from a script.
 *
 * The recorder is the assertion surface: tests check that the right token was
 * sent, that a blocked tool never reached `calls`, and that every connection
 * was closed.
 */
export const createScriptedMcp = (script: ScriptedMcpServer = {}): ScriptedMcp => {
  const recorder: ScriptedMcpRecorder = { connections: [], calls: [], openConnections: 0 };

  const factory: McpClientFactory = (settings): McpClient => {
    let connected = false;

    return {
      connect: async () => {
        if (script.connectError) {
          throw script.connectError;
        }

        recorder.connections.push({ settings });
        recorder.openConnections += 1;
        connected = true;
      },

      disconnect: async () => {
        if (connected) {
          recorder.openConnections -= 1;
          connected = false;
        }
      },

      serverInfo: () => script.serverInfo ?? { name: 'scripted-server', version: '1.0.0' },

      listTools: async (): Promise<ValidatedMcpTool[]> => {
        if (script.listError) {
          throw script.listError;
        }

        // The production validator, so a malformed tool is rejected by the code
        // under test rather than waved through by the double.
        return validateDiscoveredTools(script.tools ?? []).tools;
      },

      callTool: async (name, args) => {
        recorder.calls.push({ name, args });

        if (script.callDelayMs) {
          await new Promise((resolve) => setTimeout(resolve, script.callDelayMs));
        }

        const answer = toResult(script, name, args);

        return { ...answer, truncated: false };
      },
    };
  };

  return { factory, recorder };
};

/** A read tool, a write tool and a destructive one — the three risk classes. */
export const SCRIPTED_CRM_TOOLS: unknown[] = [
  {
    name: 'search_customers',
    description: 'Search customers by name or phone.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  {
    name: 'get_orders',
    description: 'List a customer’s orders.',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' }, limit: { type: 'integer' } },
      required: ['customerId'],
    },
  },
  {
    name: 'create_invoice',
    description: 'Create an invoice for a customer.',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' }, amount: { type: 'number' } },
      required: ['customerId', 'amount'],
    },
  },
  {
    name: 'delete_customer',
    description: 'Delete a customer record permanently.',
    inputSchema: {
      type: 'object',
      properties: { customerId: { type: 'string' } },
      required: ['customerId'],
    },
  },
];
