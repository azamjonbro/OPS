import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request, RequestHandler } from 'express';

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

/**
 * Who a per-account limit counts against.
 *
 * The signed-in employee, falling back to the address only for a request that
 * somehow reached a limiter before authentication. A shop's staff share one
 * connection, so counting by address would let one person's stuck button
 * silence everybody else's microphone — which is the failure this exists to
 * prevent, not to cause.
 */
const perActorKey = (req: Request): string => req.user?.id ?? ipKeyGenerator(req.ip ?? '');

export interface ActorRateLimitOptions {
  windowMs: number;
  max: number;
  /** Said to the person, so it explains the wait rather than naming a rule. */
  message: string;
}

/**
 * A limit on one endpoint, counted per account.
 *
 * For the handful of routes where a request costs real money rather than a few
 * milliseconds. The global limiter is about protecting the server; this is
 * about protecting a bill.
 */
export const actorRateLimiter = (options: ActorRateLimitOptions): RequestHandler =>
  rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: perActorKey,
    handler: (_req, _res, next) => {
      next(ApiError.rateLimited(options.message));
    },
  });
