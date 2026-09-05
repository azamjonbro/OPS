import { MEMORY_TYPES } from '@hadiya/shared';
import { z } from 'zod';

import * as memoryService from '../../memory/memory.service.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * The memory tools the assistant is allowed to call.
 *
 * They are the only route from a conversation to stored memory, and each one is
 * deliberately narrow: a fixed set of types, a key, a value. There is no
 * general "write a record" tool, so the model can shape what is remembered but
 * never what the database does.
 */
const memoryTypeSchema = z.enum(MEMORY_TYPES);

const keySchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .describe('Stable machine-readable name, e.g. content_language or response_style');

export const rememberInformationTool: RegisteredTool = {
  name: 'remember_information',
  category: 'memory',
  description:
    'Save a durable preference, fact or standing instruction about this user so later conversations can use it. Only call this for information that is stable and useful later — never for one-off details, and never for passwords, keys, card or account numbers.',
  mutates: true,
  schema: z.object({
    type: memoryTypeSchema.describe(
      'preference shapes how you answer, fact is context about the user or business, instruction is a standing request',
    ),
    key: keySchema,
    value: z.string().trim().min(1).max(1_000),
    confidence: z
      .number()
      .min(0)
      .max(1)
      .default(1)
      .describe('How certain you are. Below 0.7 the memory is held until the user confirms it.'),
  }),
  execute: async (args, context) => {
    const { type, key, value, confidence } = args as {
      type: (typeof MEMORY_TYPES)[number];
      key: string;
      value: string;
      confidence: number;
    };

    const result = await memoryService.remember(context.actor, {
      type,
      key,
      value,
      // The assistant proposing a memory is not the same as the user stating
      // one; the source is what keeps that distinction in the record.
      source: 'assistant',
      confidence,
      conversationId: context.conversationId,
    });

    return {
      summary: result.message,
      data: result.memory
        ? { id: String(result.memory._id), outcome: result.outcome, key: result.memory.key }
        : { outcome: result.outcome },
    };
  },
};

export const getMemoryTool: RegisteredTool = {
  name: 'get_memory',
  category: 'memory',
  description:
    'Look up what you already remember about this user. Use it before answering when a stored preference could change the answer.',
  mutates: false,
  schema: z.object({
    type: memoryTypeSchema.optional(),
    search: z.string().trim().min(1).max(80).optional().describe('Matches the key or the value'),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async (args, context) => {
    const { type, search, limit } = args as {
      type?: (typeof MEMORY_TYPES)[number];
      search?: string;
      limit: number;
    };

    const { items } = await memoryService.listMemories(context.actor, {
      page: 1,
      pageSize: limit,
      status: 'active',
      ...(type ? { type } : {}),
      ...(search ? { search } : {}),
    });

    if (items.length === 0) {
      return { summary: 'Nothing is remembered for this user yet.', data: { items: [] } };
    }

    return {
      summary: items.map((memory) => `${memory.type}.${memory.key} = ${memory.value}`).join('; '),
      data: {
        items: items.map((memory) => ({
          id: String(memory._id),
          type: memory.type,
          key: memory.key,
          value: memory.value,
        })),
      },
    };
  },
};

export const forgetInformationTool: RegisteredTool = {
  name: 'forget_information',
  category: 'memory',
  description:
    'Forget something you remember about this user. Call it when they ask you to stop remembering something. The memory stops being used immediately.',
  mutates: true,
  schema: z
    .object({
      memoryId: z.string().trim().min(1).optional().describe('Preferred when known'),
      type: memoryTypeSchema.optional(),
      key: keySchema.optional(),
    })
    .refine(
      (value) => Boolean(value.memoryId) || Boolean(value.key),
      'Provide the memory id or the key to forget',
    ),
  execute: async (args, context) => {
    const { memoryId, type, key } = args as {
      memoryId?: string;
      type?: (typeof MEMORY_TYPES)[number];
      key?: string;
    };

    const { forgotten } = await memoryService.forget(context.actor, {
      ...(memoryId ? { id: memoryId } : {}),
      ...(type ? { type } : {}),
      ...(key ? { key } : {}),
    });

    return {
      summary:
        forgotten > 0
          ? `Forgotten (${forgotten} ${forgotten === 1 ? 'memory' : 'memories'}).`
          : 'There was nothing matching that to forget.',
      data: { forgotten },
    };
  },
};

export const MEMORY_TOOLS: readonly RegisteredTool[] = [
  rememberInformationTool,
  getMemoryTool,
  forgetInformationTool,
];
