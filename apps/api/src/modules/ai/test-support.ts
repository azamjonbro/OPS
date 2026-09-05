import type { BillzCapabilityRunner, BillzProduct } from '../billz/index.js';
import type { AiCompletion, AiProvider } from './provider/ai-provider.js';
import { createBillzTools } from './tools/billz.tools.js';
import { CONTENT_TOOLS } from './tools/content.tools.js';
import { IMAGE_TOOLS } from './tools/image.tools.js';
import { MEMORY_TOOLS } from './tools/memory.tools.js';
import { REMINDER_TOOLS } from './tools/reminder.tools.js';
import { ToolRegistry } from './tools/tool-registry.js';

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

export const createScriptedProvider = (
  completions: Array<Partial<AiCompletion>>,
): ScriptedProvider => {
  const requests: Array<{ messages: unknown[]; toolNames: string[] }> = [];
  let index = 0;

  return {
    name: 'scripted',
    isConfigured: true,
    requests,
    complete: async (request) => {
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
    },
  };
};

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
export const billzProduct = (
  overrides: Partial<BillzProduct> = {},
): BillzProduct =>
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
