import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as userService from './user.service.js';
import type {
  changePasswordSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateOwnPreferencesSchema,
  updateUserSchema,
  updateUserStatusSchema,
  userIdParamSchema,
} from './user.validators.js';

export const create: ValidatedHandler<{ body: typeof createUserSchema }> = async (req, res) => {
  const user = await userService.createUser(requireActor(req), req.validated.body);

  sendCreated(req, res, user);
};

export const list: ValidatedHandler<{ query: typeof listUsersQuerySchema }> = async (req, res) => {
  const result = await userService.listUsers(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof userIdParamSchema }> = async (req, res) => {
  const user = await userService.getUser(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, user);
};

export const update: ValidatedHandler<{
  params: typeof userIdParamSchema;
  body: typeof updateUserSchema;
}> = async (req, res) => {
  const user = await userService.updateUser(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, user);
};

export const updatePreferences: ValidatedHandler<{
  body: typeof updateOwnPreferencesSchema;
}> = async (req, res) => {
  const user = await userService.updateOwnPreferences(requireActor(req), req.validated.body);

  sendSuccess(req, res, user);
};

export const updateStatus: ValidatedHandler<{
  params: typeof userIdParamSchema;
  body: typeof updateUserStatusSchema;
}> = async (req, res) => {
  const user = await userService.setUserStatus(
    requireActor(req),
    req.validated.params.id,
    req.validated.body.status,
  );

  sendSuccess(req, res, user);
};

export const changePassword: ValidatedHandler<{
  params: typeof userIdParamSchema;
  body: typeof changePasswordSchema;
}> = async (req, res) => {
  await userService.changePassword(requireActor(req), req.validated.params.id, req.validated.body);

  sendNoContent(res);
};
