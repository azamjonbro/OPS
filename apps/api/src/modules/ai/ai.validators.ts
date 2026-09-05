import { objectIdSchema } from '@hadiya/shared';
import { z } from 'zod';

/**
 * Stopping a run that is already going.
 *
 * The conversation is the handle rather than the workflow id, because that is
 * what a client actually has: it opened a chat, it sent a message, and the run
 * id was never something it needed to know. Ownership is checked against the
 * authenticated actor in the service, so naming somebody else's conversation
 * cancels nothing.
 */
export const cancelRunSchema = z.object({
  conversationId: objectIdSchema,
});

/** Naming one conversation in a path. */
export const conversationParamSchema = z.object({
  conversationId: objectIdSchema,
});

/**
 * Naming one run in a path.
 *
 * A UUID rather than an object id: a run is a process-local thing that lives
 * for the length of a turn, and it has never been a database row. The shape is
 * checked here so a malformed id is a 400 at the edge rather than a lookup
 * miss deeper in.
 */
export const runParamSchema = z.object({
  runId: z.uuid(),
});

/** How a caller asks for the streaming form of a turn. */
export const chatStreamQuerySchema = z.object({
  stream: z
    .enum(['1', 'true', 'sse'])
    .optional()
    .describe('Ask for the reply as a server-sent event stream'),
});
