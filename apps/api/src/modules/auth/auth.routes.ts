import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { validated } from '../../core/middleware/validate.js';
import * as authController from './auth.controller.js';
import { loginSchema, refreshSchema } from './auth.validators.js';

/**
 * The only routes in `/v1` reachable without a token: obtaining one, and
 * exchanging a refresh token. Mounted before the global `authenticate` guard in
 * `routes/index.ts`.
 */
export const publicAuthRouter: Router = Router();

publicAuthRouter.post('/login', ...validated({ body: loginSchema }, authController.login));
publicAuthRouter.post('/refresh', ...validated({ body: refreshSchema }, authController.refresh));

/**
 * Routes that need a valid token. Mounted under the same `/auth` path after the
 * global guard, so they do not repeat the authentication work themselves.
 */
export const authRouter: Router = Router();

authRouter.get('/me', asyncHandler(authController.me));
authRouter.post('/logout', authController.logout);
