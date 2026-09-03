import type { ApiErrorResponse } from '@hadiya/shared';
import type { ErrorRequestHandler } from 'express';

import { config } from '../../config/index.js';
import { buildResponseMeta } from '../http/api-response.js';
import { mapError } from '../http/error-mapper.js';
import { logger } from '../logger/logger.js';

/**
 * The single exit point for every failed request. Must stay last in the
 * middleware chain and must never throw.
 */
export const errorHandler = (): ErrorRequestHandler => (error, req, res, next) => {
  if (res.headersSent) {
    // The response is already on the wire; let Express destroy the socket.
    next(error);
    return;
  }

  const mapped = mapError(error);
  const log = req.log ?? logger;

  if (mapped.isOperational) {
    // Expected failures are one-liners: a stack trace for every 404 is noise.
    log.warn(
      {
        statusCode: mapped.statusCode,
        code: mapped.body.code,
        reason: error instanceof Error ? error.message : String(error),
      },
      'request failed with a handled error',
    );
  } else {
    log.error({ err: error, statusCode: mapped.statusCode }, 'unhandled error');
  }

  const body: ApiErrorResponse = {
    success: false,
    error: mapped.body,
    meta: buildResponseMeta(req),
  };

  // Stack traces are a debugging aid, never part of the production contract.
  if (!config.app.isProduction && !mapped.isOperational && error instanceof Error) {
    body.error.details = { stack: error.stack };
  }

  res.status(mapped.statusCode).json(body);
};
