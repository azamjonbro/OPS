import type { Request, Response } from 'express';

import { sendNoContent, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as authService from './auth.service.js';
import type { loginSchema, refreshSchema } from './auth.validators.js';

export const login: ValidatedHandler<{ body: typeof loginSchema }> = async (req, res) => {
  const result = await authService.login(req.validated.body);

  sendSuccess(req, res, result);
};

export const refresh: ValidatedHandler<{ body: typeof refreshSchema }> = async (req, res) => {
  const tokens = await authService.refresh(req.validated.body.refreshToken);

  sendSuccess(req, res, { tokens });
};

export const me = async (req: Request, res: Response): Promise<void> => {
  const user = await authService.currentUser(requireActor(req).id);

  sendSuccess(req, res, user);
};

/**
 * Tokens are stateless, so signing out is a client-side action: it discards the
 * pair it holds. The endpoint exists so the client has one call to make, and is
 * where a future token denylist would hook in.
 */
export const logout = (_req: Request, res: Response): void => {
  sendNoContent(res);
};
