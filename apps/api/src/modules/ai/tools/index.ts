import { MEMORY_TOOLS } from './memory.tools.js';
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
 * tools give it read-only sight of the shop's own figures. Both register the
 * same way — one call each, with no change to the agent, which only ever asks
 * the registry. Billz tools plug in here identically.
 */
export const createToolRegistry = (): ToolRegistry => {
  const registry = new ToolRegistry();

  for (const tool of [...MEMORY_TOOLS, ...SALES_TOOLS]) {
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
export { MEMORY_TOOLS } from './memory.tools.js';
export { SALES_TOOLS } from './sales.tools.js';
