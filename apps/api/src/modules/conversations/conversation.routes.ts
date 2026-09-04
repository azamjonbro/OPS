import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as conversationController from './conversation.controller.js';
import {
  conversationIdParamSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
} from './conversation.validators.js';

/**
 * Conversations are per-user and need no role beyond being signed in: every
 * query is scoped to the actor in the service, so there is nothing here one
 * employee could read from another.
 */
export const conversationRouter: Router = Router();

conversationRouter.post(
  '/',
  ...validated({ body: createConversationSchema }, conversationController.create),
);
conversationRouter.get(
  '/',
  ...validated({ query: listConversationsQuerySchema }, conversationController.list),
);
conversationRouter.get(
  '/:id',
  ...validated({ params: conversationIdParamSchema }, conversationController.detail),
);
conversationRouter.patch(
  '/:id',
  ...validated(
    { params: conversationIdParamSchema, body: updateConversationSchema },
    conversationController.update,
  ),
);
conversationRouter.delete(
  '/:id',
  ...validated({ params: conversationIdParamSchema }, conversationController.remove),
);
conversationRouter.get(
  '/:id/messages',
  ...validated(
    { params: conversationIdParamSchema, query: listMessagesQuerySchema },
    conversationController.listMessages,
  ),
);
conversationRouter.post(
  '/:id/messages',
  ...validated(
    { params: conversationIdParamSchema, body: sendMessageSchema },
    conversationController.sendMessage,
  ),
);
