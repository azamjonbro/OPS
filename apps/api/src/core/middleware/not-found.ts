import type { RequestHandler } from 'express';

import { ApiError } from '../http/api-error.js';

/** Terminal middleware: an unmatched route is a 404, not a 500. */
export const notFoundHandler = (): RequestHandler => (req, _res, next) => {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
};
