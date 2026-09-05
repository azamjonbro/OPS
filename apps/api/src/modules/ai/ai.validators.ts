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
