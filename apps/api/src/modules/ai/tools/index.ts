import type { AuthenticatedUser } from '@hadiya/shared';

import { createLogger } from '../../../core/logger/logger.js';
import { createBillzTools } from './billz.tools.js';
import { createAnalyticsTools } from '../../analytics/analytics.tools.js';
import { CONTENT_TOOLS } from './content.tools.js';
import { IMAGE_TOOLS } from './image.tools.js';
import { buildIntegrationTools } from './integration.tools.js';
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
 * The analytics tools sit on top of the Billz ones rather than beside them:
 * they read the same capability layer and turn it into figures, trends and
 * findings, so the assistant can say what changed rather than only what is.
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
    ...createAnalyticsTools(),
  ]) {
    registry.register(tool);
  }

  return registry;
};

const log = createLogger('ai-tools-registry');

/**
 * The registry for one person, for one turn.
 *
 * The built-in tools are the same for everybody, so they are built the way they
 * always were. What varies is what that account has connected: their MCP
 * servers, their Notion workspace. Those cannot live in a process-wide
 * singleton — one account's CRM tools appearing in another's registry would be
 * the exact cross-tenant leak this phase exists to prevent — so the per-actor
 * half is assembled fresh here and thrown away with the turn.
 *
 * A failure to load integrations degrades rather than fails. If the database is
 * slow or an integration is broken, the assistant answers with its built-in
 * tools instead of refusing to answer at all: losing access to a CRM should not
 * mean losing the ability to ask what sold yesterday.
 */
export const buildActorToolRegistry = async (actor: AuthenticatedUser): Promise<ToolRegistry> => {
  const registry = createToolRegistry();

  try {
    for (const tool of await buildIntegrationTools(actor)) {
      // `register` throws on a duplicate name, which is the collision guard.
      // MCP names are namespaced by integration id and so cannot collide with
      // each other; this catches a built-in tool being shadowed, which would be
      // a bug worth hearing about rather than silently resolving.
      registry.register(tool);
    }
  } catch (error) {
    log.warn({ user: actor.id, err: error }, 'integration tools could not be loaded');
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
export { asUntrustedData, buildIntegrationTools } from './integration.tools.js';
export { MEMORY_TOOLS } from './memory.tools.js';
export { REMINDER_TOOLS } from './reminder.tools.js';
