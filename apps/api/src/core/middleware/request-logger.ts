import type { RequestHandler } from 'express';

import { HTTP_STATUS } from '../http/http-status.js';

const roundMs = (value: number): number => Math.round(value * 100) / 100;

/** Logs one line per completed request, at a level chosen by the status code. */
export const requestLogger = (): RequestHandler => (req, res, next) => {
  res.on('finish', () => {
    const durationMs = roundMs(performance.now() - req.startedAt);
    const payload = {
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      ip: req.ip,
    };

    if (res.statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR) {
      req.log.error(payload, 'request failed');
      return;
    }

    if (res.statusCode >= HTTP_STATUS.BAD_REQUEST) {
      req.log.warn(payload, 'request rejected');
      return;
    }

    req.log.info(payload, 'request completed');
  });

  next();
};
