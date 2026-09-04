import type { AuthenticatedUser } from '@hadiya/shared';
import { z } from 'zod';

import { createLogger } from '../../../core/logger/logger.js';
import type { AiToolDefinition } from '../provider/ai-provider.js';

const log = createLogger('ai-tools');

/**
 * What a tool is given when it runs.
 *
 * The actor comes from the authenticated request, never from the model, so a
 * tool cannot be talked into acting as somebody else.
 */
export interface ToolContext {
  actor: AuthenticatedUser;
  conversationId: string;
}

export interface ToolResult {
  /** Short text handed back to the model as the tool's answer. */
  summary: string;
  /** Structured payload for the API response; never shown to the model raw. */
  data?: unknown;
}

export interface RegisteredTool<TSchema extends z.ZodType = z.ZodType> {
  name: string;
  /** Written for a model: what it does and when to reach for it. */
  description: string;
  schema: TSchema;
  /**
   * Whether the tool changes stored state. Read-only tools can run freely;
   * writing tools are the ones worth auditing.
   */
  mutates: boolean;
  execute: (args: z.output<TSchema>, context: ToolContext) => Promise<ToolResult>;
}

/**
 * The one place a model's tool requests are turned into code.
 *
 * Nothing else dispatches on a tool name, and nothing outside a registered tool
 * runs on the model's say-so: a name that is not registered is refused, and
 * arguments are validated against the tool's own schema before it is called.
 * That is what stops a hallucinated call from reaching the database.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, RegisteredTool>();

  register(tool: RegisteredTool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`A tool named "${tool.name}" is already registered`);
    }

    this.tools.set(tool.name, tool);
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name);
  }

  list(): RegisteredTool[] {
    return [...this.tools.values()];
  }

  /** The tool list in the shape a provider advertises to the model. */
  definitions(): AiToolDefinition[] {
    return this.list().map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.schema, { io: 'input' }) as Record<string, unknown>,
    }));
  }

  /**
   * Runs one requested call. Failures are returned, not thrown: a tool that
   * cannot answer should let the model try something else, and the transcript
   * should record what went wrong.
   */
  async execute(
    name: string,
    rawArguments: unknown,
    context: ToolContext,
  ): Promise<{ result: ToolResult; status: 'succeeded' | 'failed'; durationMs: number }> {
    const startedAt = Date.now();
    const tool = this.tools.get(name);

    if (!tool) {
      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        result: { summary: `There is no tool named "${name}".` },
      };
    }

    const parsed = tool.schema.safeParse(rawArguments ?? {});

    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
        .join('; ');

      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        result: { summary: `Invalid arguments for "${name}": ${issues}` },
      };
    }

    try {
      const result = await tool.execute(parsed.data, context);

      return { status: 'succeeded', durationMs: Date.now() - startedAt, result };
    } catch (error) {
      log.warn({ tool: name, err: error }, 'tool execution failed');

      return {
        status: 'failed',
        durationMs: Date.now() - startedAt,
        result: {
          summary: error instanceof Error ? error.message : `The tool "${name}" failed.`,
        },
      };
    }
  }
}
