import { Router } from 'express';

import { authenticate } from '../modules/auth/auth.middleware.js';
import { authRouter, publicAuthRouter } from '../modules/auth/index.js';
import { healthRouter } from '../modules/health/index.js';
import { apiModules } from '../modules/index.js';

/**
 * Route table for the whole API.
 *
 * Operational endpoints (`/health`) stay unversioned so probes never have to
 * follow a version bump; business endpoints live under `/v1`.
 */
export const createApiRouter = (): Router => {
  const router = Router();

  router.use('/health', healthRouter);

  const v1 = Router();

  // Sign-in and token refresh are the only anonymous endpoints.
  v1.use('/auth', publicAuthRouter);

  // Everything below this line requires a valid access token, so a module added
  // to the registry cannot accidentally be published without authentication.
  v1.use(authenticate());
  v1.use('/auth', authRouter);

  for (const apiModule of apiModules) {
    v1.use(apiModule.basePath, apiModule.router);
  }

  router.use('/v1', v1);

  return router;
};
