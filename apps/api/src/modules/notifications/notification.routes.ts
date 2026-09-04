import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { validated } from '../../core/middleware/validate.js';
import * as notificationController from './notification.controller.js';
import {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notification.validators.js';

/**
 * A person's own inbox. Like conversations and memory, every query is scoped to
 * the actor, so no role check applies and none would help: nothing here belongs
 * to anybody else.
 */
export const notificationRouter: Router = Router();

notificationRouter.get(
  '/',
  ...validated({ query: listNotificationsQuerySchema }, notificationController.list),
);
/** Literal paths are declared before `/:id` so they win the match. */
notificationRouter.get('/unread-count', asyncHandler(notificationController.unreadCount));
notificationRouter.post('/read-all', asyncHandler(notificationController.readAll));
notificationRouter.get(
  '/:id',
  ...validated({ params: notificationIdParamSchema }, notificationController.detail),
);
notificationRouter.post(
  '/:id/read',
  ...validated({ params: notificationIdParamSchema }, notificationController.read),
);
notificationRouter.delete(
  '/:id',
  ...validated({ params: notificationIdParamSchema }, notificationController.remove),
);
