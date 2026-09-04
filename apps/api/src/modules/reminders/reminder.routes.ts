import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as reminderController from './reminder.controller.js';
import {
  createReminderSchema,
  listRemindersQuerySchema,
  reminderIdParamSchema,
  updateReminderSchema,
} from './reminder.validators.js';

/**
 * A person's own reminders. Every query in the service is scoped to the actor,
 * so no role check applies: there is nothing here that belongs to anyone else,
 * and an owner may always manage their own.
 */
export const reminderRouter: Router = Router();

reminderRouter.post('/', ...validated({ body: createReminderSchema }, reminderController.create));
reminderRouter.get('/', ...validated({ query: listRemindersQuerySchema }, reminderController.list));
reminderRouter.get(
  '/:id',
  ...validated({ params: reminderIdParamSchema }, reminderController.detail),
);
reminderRouter.patch(
  '/:id',
  ...validated(
    { params: reminderIdParamSchema, body: updateReminderSchema },
    reminderController.update,
  ),
);
reminderRouter.post(
  '/:id/cancel',
  ...validated({ params: reminderIdParamSchema }, reminderController.cancel),
);
/**
 * Cancelling is what deleting means here: the row is kept so a person can still
 * see that a reminder existed and why it never arrived.
 */
reminderRouter.delete(
  '/:id',
  ...validated({ params: reminderIdParamSchema }, reminderController.cancel),
);
