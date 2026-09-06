import { LOGIN_RATE_LIMIT, REFRESH_RATE_LIMIT } from '@hadiya/shared';
import { Router } from 'express';

import { config } from '../../config/index.js';
import { asyncHandler } from '../../core/http/async-handler.js';
import { credentialRateLimiter } from '../../core/middleware/rate-limit.js';
import { validated } from '../../core/middleware/validate.js';
import * as authController from './auth.controller.js';
import { loginSchema, refreshSchema } from './auth.validators.js';

/**
 * The only routes in `/v1` reachable without a token: obtaining one, and
 * exchanging a refresh token. Mounted before the global `authenticate` guard in
 * `routes/index.ts`.
 *
 * Both carry a limiter of their own. The global one counts every request from
 * an address into a single budget of several hundred a minute, which is a fine
 * ceiling for reads and no defence at all for a password: it permits thousands
 * of guesses an hour against an account whose owner chose something short.
 * These budgets are small, are counted per address *and* per username, and —
 * for sign-in — are spent only by failures, so nobody is ever locked out by
 * their own correct password.
 */
export const publicAuthRouter: Router = Router();

publicAuthRouter.post(
  '/login',
  credentialRateLimiter({
    windowMs: LOGIN_RATE_LIMIT.windowMs,
    max: config.http.endpointLimits.loginMax,
    identifierField: 'username',
    skipSuccessful: true,
    message: 'Too many sign-in attempts. Wait a few minutes and try again.',
  }),
  ...validated({ body: loginSchema }, authController.login),
);
publicAuthRouter.post(
  '/refresh',
  credentialRateLimiter({
    windowMs: REFRESH_RATE_LIMIT.windowMs,
    max: REFRESH_RATE_LIMIT.max,
    message: 'Too many token refreshes. Wait a moment and try again.',
  }),
  ...validated({ body: refreshSchema }, authController.refresh),
);

/**
 * Routes that need a valid token. Mounted under the same `/auth` path after the
 * global guard, so they do not repeat the authentication work themselves.
 */
export const authRouter: Router = Router();

authRouter.get('/me', asyncHandler(authController.me));
authRouter.post('/logout', authController.logout);
