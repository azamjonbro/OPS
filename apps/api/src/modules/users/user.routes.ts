import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as userController from './user.controller.js';
import {
  changePasswordSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateOwnPreferencesSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from './user.validators.js';

export const userRouter: Router = Router();

userRouter.post('/', ...validated({ body: createUserSchema }, userController.create));
userRouter.get('/', ...validated({ query: listUsersQuerySchema }, userController.list));
/** Literal paths come before `/:id` so they are not read as an object id. */
userRouter.patch(
  '/me/preferences',
  ...validated({ body: updateOwnPreferencesSchema }, userController.updatePreferences),
);
userRouter.get('/:id', ...validated({ params: userIdParamSchema }, userController.detail));
userRouter.patch(
  '/:id',
  ...validated({ params: userIdParamSchema, body: updateUserSchema }, userController.update),
);
userRouter.patch(
  '/:id/status',
  ...validated(
    { params: userIdParamSchema, body: updateUserStatusSchema },
    userController.updateStatus,
  ),
);
userRouter.post(
  '/:id/password',
  ...validated(
    { params: userIdParamSchema, body: changePasswordSchema },
    userController.changePassword,
  ),
);
