import { CONVERSATION_STATUSES, objectIdSchema, paginationQuerySchema } from '@hadiya/shared';
import { z } from 'zod';

export const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
});

export const listConversationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CONVERSATION_STATUSES).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    status: z.enum(CONVERSATION_STATUSES),
  })
  .partial()
  .refine((value) => value.title !== undefined || value.status !== undefined, 'Nothing to update');

export const conversationIdParamSchema = z.object({ id: objectIdSchema });

export const listMessagesQuerySchema = paginationQuerySchema;

/** A turn typed by a person, so the ceiling is generous but not unbounded. */
export const sendMessageSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
});

export const chatSchema = z.object({
  conversationId: objectIdSchema.optional(),
  message: z.string().trim().min(1).max(8_000),
});
