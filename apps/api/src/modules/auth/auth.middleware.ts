import type { RequestHandler } from 'express';

import { ApiError } from '../../core/http/api-error.js';
import { resolveActor } from './auth.service.js';

const BEARER_PREFIX = 'Bearer ';

const readBearerToken = (header: string | undefined): string => {
  if (!header || !header.startsWith(BEARER_PREFIX)) {
    throw ApiError.unauthenticated('A bearer token is required');
  }

  const token = header.slice(BEARER_PREFIX.length).trim();

  if (!token) {
    throw ApiError.unauthenticated('A bearer token is required');
  }

  return token;
};

/**
 * Rejects any request without a valid access token, and attaches the principal.
 * Mounted once over the whole `/v1` tree, so a new module is protected by
 * default instead of having to remember the guard.
 */
export const authenticate = (): RequestHandler => (req, _res, next) => {
  void (async () => {
    req.user = await resolveActor(readBearerToken(req.headers.authorization));
  })()
    .then(() => next())
    .catch(next);
};
