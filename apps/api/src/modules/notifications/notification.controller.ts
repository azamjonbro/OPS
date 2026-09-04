import type { Request, Response } from 'express';

import { sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as notificationService from './notification.service.js';
import type {
  listNotificationsQuerySchema,
  notificationIdParamSchema,
} from './notification.validators.js';

export const list: ValidatedHandler<{ query: typeof listNotificationsQuerySchema }> = async (
  req,
  res,
) => {
  const result = await notificationService.listNotifications(
    requireActor(req),
    req.validated.query,
  );

  sendPaginated(req, res, result);
};

/** The badge. Kept as its own endpoint so a client can poll it cheaply. */
export const unreadCount = async (req: Request, res: Response): Promise<void> => {
  const unread = await notificationService.countUnread(requireActor(req));

  sendSuccess(req, res, { unread });
};

export const detail: ValidatedHandler<{ params: typeof notificationIdParamSchema }> = async (
  req,
  res,
) => {
  const notification = await notificationService.getNotification(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, notification);
};

export const read: ValidatedHandler<{ params: typeof notificationIdParamSchema }> = async (
  req,
  res,
) => {
  const notification = await notificationService.markRead(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, notification);
};

export const readAll = async (req: Request, res: Response): Promise<void> => {
  const result = await notificationService.markAllRead(requireActor(req));

  sendSuccess(req, res, result);
};

export const remove: ValidatedHandler<{ params: typeof notificationIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await notificationService.removeNotification(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, result);
};
