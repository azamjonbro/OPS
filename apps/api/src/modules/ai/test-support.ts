import { z } from 'zod';

import type { BillzCapabilityRunner, BillzProduct } from '../billz/index.js';
import type { AiCompletion, AiCompletionRequest, AiProvider } from './provider/ai-provider.js';
import { createBillzTools } from './tools/billz.tools.js';
import { CONTENT_TOOLS } from './tools/content.tools.js';
import { IMAGE_TOOLS } from './tools/image.tools.js';
import { MEMORY_TOOLS } from './tools/memory.tools.js';
import { REMINDER_TOOLS } from './tools/reminder.tools.js';
import { ToolRegistry, type RegisteredTool, type ToolContext } from './tools/tool-registry.js';

/**
 * A scripted model, for tests.
 *
 * Automated tests never call a paid API: the agent is written against the
 * provider interface, so a suite can hand it a fixed sequence of completions
 * and assert on exactly what the model was shown.
 */
export interface ScriptedProvider extends AiProvider {
  /** Every request the agent made, in order. */
  readonly requests: Array<{ messages: unknown[]; toolNames: string[] }>;
}

export interface ScriptedProviderOptions {
  /**
   * Whether this double answers through `stream` as well as `complete`.
   *
   * Off by default, which is what keeps every existing test on the path it was
   * written for. On, the scripted text is handed back a few characters at a
   * time — the point being to prove that a caller reassembles it into exactly
   * the completion the non-streaming path would have produced.
   */
  streaming?: boolean;
  /** Characters per delta. Small, so a short answer still arrives in pieces. */
  chunkSize?: number;
}

export const createScriptedProvider = (
  completions: Array<Partial<AiCompletion>>,
  options: ScriptedProviderOptions = {},
): ScriptedProvider => {
  const requests: Array<{ messages: unknown[]; toolNames: string[] }> = [];
  let index = 0;

  const answer = (request: AiCompletionRequest): AiCompletion => {
    requests.push({
      messages: request.messages,
      toolNames: request.tools.map((tool) => tool.name),
    });

    const scripted = completions[index] ?? completions.at(-1) ?? {};
    index += 1;

    return {
      content: scripted.content ?? 'Understood.',
      toolCalls: scripted.toolCalls ?? [],
      model: scripted.model ?? 'scripted-model',
      usage: scripted.usage ?? { promptTokens: 10, completionTokens: 5 },
    };
  };

  const provider: ScriptedProvider = {
    name: 'scripted',
    isConfigured: true,
    requests,
    complete: (request) => Promise.resolve(answer(request)),
  };

  if (options.streaming) {
    const size = options.chunkSize ?? 4;

    return {
      ...provider,
      supportsStreaming: true,
      stream: async (request, onChunk) => {
        const completion = answer(request);

        for (let at = 0; at < completion.content.length; at += size) {
          onChunk({ delta: completion.content.slice(at, at + size), done: false });
          // Yields to the event loop, so a subscriber sees deltas arrive over
          // time rather than all at once after the call has already returned.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }

        onChunk({ delta: '', done: true });

        return completion;
      },
    };
  }

  return provider;
};

/* -------------------------------------------------------------------------- */
/* Server-sent events                                                         */
/* -------------------------------------------------------------------------- */

export interface SseFrame {
  id: string | null;
  event: string;
  data: unknown;
}

/**
 * Reads an SSE body back into frames.
 *
 * Written against the wire format rather than against the writer, so a test
 * asserts what a browser would actually receive: `id`, `event` and one `data`
 * line per frame, separated by a blank line. Comments (heartbeats) are dropped.
 */
export const parseSse = (body: string): SseFrame[] =>
  body
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.length > 0 && !block.startsWith(':'))
    .flatMap((block) => {
      let id: string | null = null;
      let event = 'message';
      let data = '';

      for (const line of block.split('\n')) {
        if (line.startsWith('id:')) {
          id = line.slice(3).trim();
        } else if (line.startsWith('event:')) {
          event = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          data += line.slice(5).trim();
        }
      }

      if (data.length === 0) {
        return [];
      }

      return [{ id, event, data: JSON.parse(data) as unknown }];
    });

/**
 * A registry whose Billz tools answer from a script rather than from Billz.
 *
 * The shop's figures live in Billz now, so a test that needs the assistant to
 * "look up a product first" cannot insert a row and expect the tool to find it.
 * It hands the capability a canned answer instead — which is closer to the
 * truth anyway: what the assistant sees is whatever Billz says, and this is the
 * only place a test gets to decide that.
 *
 * Capabilities left out of `stub` are simply absent; a tool that calls one
 * fails the way an unreachable Billz would, which is a case worth being able to
 * write a test for.
 */
export const createRegistryWithBillz = (stub: Partial<BillzCapabilityRunner>): ToolRegistry => {
  const registry = new ToolRegistry();

  for (const tool of [
    ...MEMORY_TOOLS,
    ...REMINDER_TOOLS,
    ...CONTENT_TOOLS,
    ...IMAGE_TOOLS,
    ...createBillzTools(() => stub as BillzCapabilityRunner),
  ]) {
    registry.register(tool);
  }

  return registry;
};

/** One Billz product, with only the fields a tool or a test actually reads. */
export const billzProduct = (overrides: Partial<BillzProduct> = {}): BillzProduct =>
  ({
    externalId: 'billz-product-1',
    name: 'Cola 1L',
    sku: 'COLA-1L',
    barcode: null,
    description: null,
    brand: null,
    categoryName: null,
    categoryExternalId: null,
    unit: 'piece',
    imageUrl: null,
    retailPrice: 1_200_000,
    supplyPrice: 900_000,
    currency: 'UZS',
    prices: [],
    stock: [],
    totalStock: 10,
    updatedAt: null,
    ...overrides,
  }) satisfies BillzProduct;

/* -------------------------------------------------------------------------- */
/* Agent orchestration                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A tool whose behaviour a test dictates, with a record of how it was called.
 *
 * Orchestration is about *when* tools run rather than what they do, so most of
 * these tests need a tool that is slow, or fails twice then works, or notices
 * that another one is running at the same moment. Writing that against real
 * tools would test Billz and Notion again; writing it against a probe tests the
 * scheduler, which is the part that is new.
 */
export interface ToolProbe {
  tool: RegisteredTool;
  /** Every call, in the order they started. */
  readonly calls: Array<{ args: Record<string, unknown>; at: number; attempt: number }>;
  /** The highest number of this tool's calls that were ever in flight at once. */
  readonly peakConcurrency: number;
  /** Windows during which a call was running, for overlap assertions. */
  readonly windows: Array<{ start: number; end: number }>;
}

export interface ProbeOptions extends Partial<Omit<RegisteredTool, 'name' | 'execute' | 'schema'>> {
  name: string;
  /** Held open for this long before answering. */
  delayMs?: number;
  /** Thrown on the first N attempts; the call succeeds afterwards. */
  failTimes?: number;
  /** What to throw while failing. Defaults to something transient-looking. */
  error?: () => Error;
  /** The summary a successful call returns. */
  summary?: string;
  data?: unknown;
}

export const createToolProbe = (options: ProbeOptions): ToolProbe => {
  const calls: ToolProbe['calls'] = [];
  const windows: ToolProbe['windows'] = [];
  let inFlight = 0;
  let peakConcurrency = 0;
  let failures = 0;

  const {
    name,
    delayMs = 0,
    failTimes = 0,
    error,
    summary,
    data,
    mutates = false,
    ...metadata
  } = options;

  const probe = {
    calls,
    windows,
    get peakConcurrency() {
      return peakConcurrency;
    },
    tool: {
      name,
      description: `Probe tool ${name}.`,
      schema: z.looseObject({ confirm: z.boolean().optional() }),
      mutates,
      ...metadata,
      execute: async (args: unknown, context: ToolContext) => {
        const start = Date.now();

        calls.push({
          args: (args ?? {}) as Record<string, unknown>,
          at: start,
          attempt: context.attempt ?? 1,
        });

        inFlight += 1;
        peakConcurrency = Math.max(peakConcurrency, inFlight);

        try {
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }

          if (failures < failTimes) {
            failures += 1;

            throw error ? error() : new Error('ECONNRESET while talking to the service');
          }

          return { summary: summary ?? `${name} done`, data };
        } finally {
          inFlight -= 1;
          windows.push({ start, end: Date.now() });
        }
      },
    } as unknown as RegisteredTool,
  };

  return probe;
};

/** A registry holding exactly the tools a test cares about, and nothing else. */
export const createProbeRegistry = (tools: RegisteredTool[]): ToolRegistry => {
  const registry = new ToolRegistry();

  for (const tool of tools) {
    registry.register(tool);
  }

  return registry;
};

/** One tool call in a scripted completion, spelled out once. */
export const toolCall = (
  name: string,
  args: Record<string, unknown> = {},
  callId = `call-${name}`,
): { callId: string; name: string; arguments: Record<string, unknown> } => ({
  callId,
  name,
  arguments: args,
});

/** Limits that make a test finish in milliseconds rather than in minutes. */
export const FAST_AGENT_LIMITS = {
  maxToolRounds: 3,
  maxModelCalls: 6,
  maxParallelTools: 4,
  toolTimeoutMs: 1_000,
  maxToolRetries: 2,
  // No real backoff: what is under test is that a retry happens, not that Node
  // can wait.
  retryBackoffMs: 1,
  tokenBudget: 1_000_000,
} as const;
