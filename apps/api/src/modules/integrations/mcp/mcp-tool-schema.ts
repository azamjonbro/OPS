import { MCP_LIMITS, type McpToolRisk } from '@hadiya/shared';
import { z } from 'zod';

import { classifyToolRisk } from './mcp-permissions.js';

/**
 * The border post for everything an MCP server says about itself.
 *
 * A `tools/list` response is external input in the strongest sense: it is
 * written by whoever runs the server, it is fed straight into a model's prompt,
 * and the model then produces arguments against it. That makes tool metadata an
 * injection surface twice over — once into the prompt, once into the argument
 * validation — so nothing from it reaches Hadiya's storage or the model without
 * passing through here.
 *
 * The rules are boring on purpose: names must look like names, text is
 * truncated, schemas are bounded, and anything malformed is dropped rather than
 * repaired. A server that sends one bad tool loses that tool and keeps the
 * rest, because failing the whole discovery over one entry would let a broken
 * tool hold a working integration hostage.
 */

/**
 * What a tool may be called.
 *
 * Constrained enough to be safely concatenated into a registry name, printed in
 * a prompt and matched by `parseMcpToolRegistryName`. Notably: no dots (they
 * are the namespace separator), no whitespace, no control characters, and
 * nothing that could pass for a role marker in a prompt.
 */
const TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/** Control characters, which can carry terminal escapes. */
// eslint-disable-next-line no-control-regex -- removing them is the point.
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Zero-width and bidirectional formatting characters.
 *
 * These hide one string inside another: a description that reads as harmless to
 * a reviewer can carry instructions a model still sees. There is no legitimate
 * use for them in a tool description, so they are removed rather than escaped.
 */
const INVISIBLE_CHARACTERS = /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;

/** Strips what has no business in text that will be shown to a model. */
export const sanitiseExternalText = (value: string, maxLength: number): string =>
  value
    .replace(CONTROL_CHARACTERS, ' ')
    .replace(INVISIBLE_CHARACTERS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);

/**
 * A JSON Schema for tool arguments, as far as Hadiya insists.
 *
 * Only the top level is checked, and only for the shape a tool call needs: an
 * object schema with named properties. Validating the whole of JSON Schema
 * would be a project of its own, and it is not what protects anything here —
 * the schema is compiled into a Zod validator by `buildArgumentValidator`, and
 * anything it cannot express becomes a rejected argument rather than a passed
 * one.
 */
const inputSchemaSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string(), z.unknown()).optional(),
    required: z.array(z.string()).optional(),
  })
  .loose();

const rawToolSchema = z.object({
  name: z.string().regex(TOOL_NAME_PATTERN),
  description: z.string().optional(),
  inputSchema: inputSchemaSchema,
  annotations: z
    .object({
      title: z.string().optional(),
      readOnlyHint: z.boolean().optional(),
      destructiveHint: z.boolean().optional(),
      idempotentHint: z.boolean().optional(),
    })
    .loose()
    .optional(),
});

export interface ValidatedMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  risk: McpToolRisk;
}

export interface ToolValidationOutcome {
  tools: ValidatedMcpTool[];
  /** Names that were dropped and why, for the audit row and the logs. */
  rejected: Array<{ name: string; reason: string }>;
  /** True when the server offered more tools than Hadiya will keep. */
  truncated: boolean;
}

/**
 * Turns a raw `tools/list` payload into what Hadiya is willing to store.
 *
 * Duplicate names are dropped rather than merged: two tools called
 * `delete_customer` with different schemas is either a broken server or a
 * deliberate attempt to have the second definition shadow a permission a person
 * set against the first, and neither deserves the benefit of the doubt.
 */
export const validateDiscoveredTools = (raw: unknown): ToolValidationOutcome => {
  const tools: ValidatedMcpTool[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  const seen = new Set<string>();

  if (!Array.isArray(raw)) {
    return {
      tools,
      rejected: [{ name: '(response)', reason: 'the server did not return a list of tools' }],
      truncated: false,
    };
  }

  const truncated = raw.length > MCP_LIMITS.maxTools;

  for (const entry of raw.slice(0, MCP_LIMITS.maxTools)) {
    const parsed = rawToolSchema.safeParse(entry);

    if (!parsed.success) {
      const claimed: unknown = (entry as { name?: unknown } | null)?.name;
      const name = typeof claimed === 'string' ? sanitiseExternalText(claimed, 64) : '(unnamed)';

      rejected.push({ name: name || '(unnamed)', reason: 'the tool definition was malformed' });
      continue;
    }

    const tool = parsed.data;

    if (seen.has(tool.name)) {
      rejected.push({ name: tool.name, reason: 'a tool with that name was already listed' });
      continue;
    }

    // A schema large enough to matter is a schema aimed at the context window.
    if (JSON.stringify(tool.inputSchema).length > MCP_LIMITS.maxToolSchemaBytes) {
      rejected.push({ name: tool.name, reason: 'the argument schema was too large' });
      continue;
    }

    seen.add(tool.name);

    const description = sanitiseExternalText(
      tool.description ?? '',
      MCP_LIMITS.maxToolDescriptionLength,
    );

    tools.push({
      name: tool.name,
      description,
      inputSchema: tool.inputSchema as Record<string, unknown>,
      risk: classifyToolRisk({
        name: tool.name,
        description,
        ...(tool.annotations === undefined ? {} : { annotations: tool.annotations }),
      }),
    });
  }

  return { tools, rejected, truncated };
};

/**
 * Builds the validator a model's arguments are checked against.
 *
 * The model invents these arguments, and they are about to be sent to somebody
 * else's server, so "the schema said so" is not enough — the object has to be
 * checked against it before it leaves. What is built is deliberately shallow:
 * the declared top-level properties by their declared primitive types, required
 * ones required, everything else passed through as opaque JSON.
 *
 * Shallow is honest here. A full JSON Schema compiler would claim a precision
 * this data does not have — the schema is the untrusted server's own
 * description of itself — and the real protections are elsewhere: the tool
 * cannot run without a permission, the arguments cannot exceed a size, and the
 * call cannot outlive its timeout.
 */
export const buildArgumentValidator = (inputSchema: Record<string, unknown>): z.ZodType => {
  const properties = inputSchema.properties;
  const required = Array.isArray(inputSchema.required)
    ? new Set(inputSchema.required.filter((name): name is string => typeof name === 'string'))
    : new Set<string>();

  if (typeof properties !== 'object' || properties === null) {
    // No declared properties: accept any object and let the server judge.
    return z.record(z.string(), z.unknown());
  }

  const shape: Record<string, z.ZodType> = {};

  for (const [name, definition] of Object.entries(properties as Record<string, unknown>)) {
    const type =
      typeof definition === 'object' && definition !== null
        ? (definition as { type?: unknown }).type
        : undefined;

    const base = ((): z.ZodType => {
      switch (type) {
        case 'string':
          return z.string();
        case 'number':
          return z.number();
        case 'integer':
          return z.number().int();
        case 'boolean':
          return z.boolean();
        case 'array':
          return z.array(z.unknown());
        case 'object':
          return z.record(z.string(), z.unknown());
        default:
          // A union type, an unstated one, or something exotic: not Hadiya's
          // business to second-guess.
          return z.unknown();
      }
    })();

    shape[name] = required.has(name) ? base : base.optional();
  }

  // Unknown keys pass through: a server may accept more than it documents, and
  // rejecting extras would break tools that are working.
  return z.object(shape).loose();
};
