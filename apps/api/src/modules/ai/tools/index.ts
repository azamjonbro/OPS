import { createBillzTools } from './billz.tools.js';
import { CONTENT_TOOLS } from './content.tools.js';
import { IMAGE_TOOLS } from './image.tools.js';
import { MEMORY_TOOLS } from './memory.tools.js';
import { REMINDER_TOOLS } from './reminder.tools.js';
import {
  ToolRegistry,
  type RegisteredTool,
  type ToolContext,
  type ToolResult,
} from './tool-registry.js';

/**
 * Builds the registry the agent runs with.
 *
 * Memory lets the assistant carry preferences between conversations; the Billz
 * tools give it read-only sight of the shop as it stands *right now* — the
 * catalogue, the till, the stock, who owes what; the reminder tools let it
 * schedule work for later; the content tools let it plan and write posts, and
 * the image tool lets it draw one.
 *
 * None of them changes the agent, which only ever asks the registry, so a
 * capability is added here in one line.
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
    ...IMAGE_TOOLS,
    ...createBillzTools(),
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
export { createBillzTools } from './billz.tools.js';
export { CONTENT_TOOLS } from './content.tools.js';
export { IMAGE_TOOLS } from './image.tools.js';
export { MEMORY_TOOLS } from './memory.tools.js';
export { REMINDER_TOOLS } from './reminder.tools.js';
