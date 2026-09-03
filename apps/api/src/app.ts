import compression from 'compression';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { config } from './config/index.js';
import { errorHandler } from './core/middleware/error-handler.js';
import { notFoundHandler } from './core/middleware/not-found.js';
import { apiRateLimiter } from './core/middleware/rate-limit.js';
import { requestContext } from './core/middleware/request-context.js';
import { requestLogger } from './core/middleware/request-logger.js';
import { createApiRouter } from './routes/index.js';

/**
 * Builds the Express application without binding a port, so tests can drive it
 * in-process and the entrypoint stays responsible for the network only.
 *
 * Middleware order is deliberate: context first (everything below logs with a
 * request id), security and parsing next, then routes, then the terminal 404
 * and error handlers.
 */
export const createApp = (): Express => {
  const app = express();

  if (config.http.trustProxy) {
    // Required for correct client IPs (rate limiting, logs) behind a proxy.
    app.set('trust proxy', 1);
  }

  app.disable('x-powered-by');

  app.use(requestContext());
  app.use(requestLogger());
  app.use(helmet());
  app.use(
    cors({
      origin: config.http.corsOrigins,
      credentials: true,
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: config.http.bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: config.http.bodyLimit }));

  app.use(config.http.basePath, apiRateLimiter(), createApiRouter());

  app.use(notFoundHandler());
  app.use(errorHandler());

  return app;
};
