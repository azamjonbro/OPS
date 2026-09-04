import { CATALOG_TOOLS } from './catalog.tools.js';
import { CONTENT_TOOLS } from './content.tools.js';
import { MEMORY_TOOLS } from './memory.tools.js';
import { REMINDER_TOOLS } from './reminder.tools.js';
import { SALES_TOOLS } from './sales.tools.js';
import {
  ToolRegistry,
  type RegisteredTool,
  type ToolContext,
  type ToolResult,
} from './tool-registry.js';

/**
 * Builds the registry the agent runs with.
 *
 * Memory lets the assistant carry preferences between conversations; the sales
 * and catalogue tools give it read-only sight of the shop's own figures; the
 * reminder tools let it schedule work for later; the content tools let it plan
 * and write posts. None of them changes the agent, which only ever asks the
 * registry — a capability is added here in one line. Billz tools plug in
 * identically.
 *
 * Order matters only for how the list reads to a person; the model picks by
 * name and description, never by position.
 */
export const createToolRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry();

  for (const tool of [
    ...MEMORY_TOOLS,
    ...REMINDER_TOOLS,
    ...CONTENT_TOOLS,
    ...SALES_TOOLS,
    ...CATALOG_TOOLS,
  ]) {
    registry.register(tool);
  }

  return registry;
};

let cached: ToolRegistry | null = null;

export const getToolRegistry = (): ToolRegistry => {
  cached ??= createToolRegistry();

  return cached;
};

/** Testing seam: forces the next `getToolRegistry()` to rebuild. */
export const resetToolRegistry = (): void => {
  cached = null;
};

export { ToolRegistry };
export type { RegisteredTool, ToolContext, ToolResult };
export { CATALOG_TOOLS } from './catalog.tools.js';
export { CONTENT_TOOLS } from './content.tools.js';
export { MEMORY_TOOLS } from './memory.tools.js';
export { REMINDER_TOOLS } from './reminder.tools.js';
export { SALES_TOOLS } from './sales.tools.js';
