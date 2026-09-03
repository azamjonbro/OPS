import { randomUUID } from 'node:crypto';

import type { RequestHandler } from 'express';

import { logger } from '../logger/logger.js';

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_INBOUND_ID_LENGTH = 128;

const readInboundRequestId = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  // An untrusted header must never end up unbounded in logs.
  return trimmed.length > 0 && trimmed.length <= MAX_INBOUND_ID_LENGTH ? trimmed : undefined;
};

/**
 * Gives every request an id, a start timestamp and a bound logger. Runs before
 * anything that logs or responds.
 */
export const requestContext = (): RequestHandler => (req, res, next) => {
  req.id = readInboundRequestId(req.headers[REQUEST_ID_HEADER]) ?? randomUUID();
  req.startedAt = performance.now();
  req.log = logger.child({ requestId: req.id });

  res.setHeader(REQUEST_ID_HEADER, req.id);
  next();
};
