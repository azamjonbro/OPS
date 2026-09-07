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

/** Reads a short, safe identifier out of an unauthenticated request body. */
const bodyIdentifier = (req: Request, field: string): string => {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];

  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 64) : '';
};

export interface CredentialRateLimitOptions extends ActorRateLimitOptions {
  /**
   * A body field counted alongside the address, so one account cannot be ground
   * down from many addresses and one address cannot work through many accounts.
   * Omit to count by address alone.
   */
  identifierField?: string;
  /**
   * Whether a successful request is refunded.
   *
   * On for sign-in: the budget is for *failures*, so a person typing their own
   * password correctly all day is never locked out by it, and the limit means
   * exactly what it says — ten wrong guesses.
   */
  skipSuccessful?: boolean;
}

/**
 * A limit on an endpoint that runs before anybody is authenticated.
 *
 * `actorRateLimiter` counts against `req.user`, which sign-in does not have and
 * is the whole point of attacking. This counts against the address and, where
 * one is given, the identifier in the body — so guessing one account's password
 * from a botnet and guessing every account's password from one address are both
 * bounded, and neither can be widened by rotating the other.
 *
 * State is per process, like every limiter here. Behind several instances the
 * effective budget multiplies by the instance count, which is the honest
 * limitation: a shared store on the sign-in path is the correct fix when there
 * is more than one instance, and the account lockout a deployment really wants
 * is a database decision rather than a middleware one.
 */
export const credentialRateLimiter = (options: CredentialRateLimitOptions): RequestHandler =>
  rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: options.skipSuccessful ?? false,
    keyGenerator: (req: Request) => {
      const address = ipKeyGenerator(req.ip ?? '');

      return options.identifierField
        ? `${address}|${bodyIdentifier(req, options.identifierField)}`
        : address;
    },
    handler: (_req, _res, next) => {
      next(ApiError.rateLimited(options.message));
    },
  });
