import http from 'node:http';

import { createApp } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './core/db/connection.js';
import { createShutdownManager, registerProcessSignalHandlers } from './core/lifecycle/shutdown.js';
import { logger } from './core/logger/logger.js';

const CONNECT_ATTEMPTS = 5;
const CONNECT_BACKOFF_MS = 1_000;
const MAX_CONNECT_BACKOFF_MS = 10_000;

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * The database is a required dependency: the process refuses to start serving
 * without it, but a slow-starting database (a fresh container, a restarting
 * replica set) is retried before giving up.
 */
const connectDatabaseWithRetry = async (): Promise<void> => {
  for (let attempt = 1; attempt <= CONNECT_ATTEMPTS; attempt += 1) {
    try {
      await connectDatabase();
      return;
    } catch (error) {
      if (attempt === CONNECT_ATTEMPTS) {
        throw error;
      }

      const backoffMs = Math.min(CONNECT_BACKOFF_MS * 2 ** (attempt - 1), MAX_CONNECT_BACKOFF_MS);

      logger.warn(
        { err: error, attempt, attempts: CONNECT_ATTEMPTS, backoffMs },
        'database connection failed, retrying',
      );

      await delay(backoffMs);
    }
  }
};

const closeServer = (server: http.Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const bootstrap = async (): Promise<void> => {
  const shutdownManager = createShutdownManager({
    logger,
    timeoutMs: config.http.shutdownTimeoutMs,
  });

  registerProcessSignalHandlers(shutdownManager, logger);

  await connectDatabaseWithRetry();
  shutdownManager.register({ name: 'database', run: disconnectDatabase });

  const server = http.createServer(createApp());

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.http.port, config.http.host, resolve);
  });

  shutdownManager.register({
    name: 'http-server',
    run: async () => {
      // Stop accepting connections, then let in-flight requests finish.
      await closeServer(server);
    },
  });

  logger.info(
    {
      url: `http://${config.http.host}:${config.http.port}${config.http.basePath}`,
      env: config.app.env,
      version: config.app.version,
    },
    'hadiya api is listening',
  );
};

bootstrap().catch((error: unknown) => {
  logger.fatal({ err: error }, 'failed to start the api');
  process.exitCode = 1;
  // Give the logger a tick to flush before the process ends.
  setTimeout(() => process.exit(1), 100).unref();
});
