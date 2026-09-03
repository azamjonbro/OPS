import rateLimit from 'express-rate-limit';
import type { RequestHandler } from 'express';

import { config } from '../../config/index.js';
import { ApiError } from '../http/api-error.js';

/**
 * Coarse protection for the whole API surface. Per-endpoint limits (login
 * attempts, AI calls) are layered on top by the modules that need them.
 */
export const apiRateLimiter = (): RequestHandler =>
  rateLimit({
    windowMs: config.http.rateLimit.windowMs,
    limit: config.http.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    // Route the rejection through the normal error envelope.
    handler: (_req, _res, next) => {
      next(ApiError.rateLimited());
    },
  });
