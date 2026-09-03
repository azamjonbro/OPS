import { Router } from 'express';

import { apiModules } from '../modules/index.js';
import { healthRouter } from '../modules/health/index.js';

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

  for (const apiModule of apiModules) {
    v1.use(apiModule.basePath, apiModule.router);
  }

  router.use('/v1', v1);

  return router;
};
