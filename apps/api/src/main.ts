import http from 'node:http';

import { createApp } from './app.js';
import { config } from './config/index.js';
import { connectDatabase, disconnectDatabase } from './core/db/connection.js';
import { probeTransactionSupport } from './core/db/transaction.js';
import { createShutdownManager, registerProcessSignalHandlers } from './core/lifecycle/shutdown.js';
import { logger } from './core/logger/logger.js';
import { registeredJobTypes, startScheduler, stopScheduler } from './core/scheduler/index.js';
import { registerImageStorage } from './modules/images/index.js';
import { registerDefaultNotificationProviders } from './modules/notifications/index.js';
import { recoverPendingReminders, registerReminderJobs } from './modules/reminders/index.js';

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

/**
 * Production start-up already refuses to run without signing keys. Outside
 * production they stay optional so the service can boot for a health check, but
 * every authentication endpoint will fail until they are set — which is worth
 * saying once, loudly, at start-up rather than at the first failed login.
 */
const warnAboutMissingAuthSecrets = (): void => {
  if (config.auth.accessSecret && config.auth.refreshSecret) {
    return;
  }

  logger.warn(
    'JWT_ACCESS_SECRET / JWT_REFRESH_SECRET are not set: sign-in and every authenticated endpoint will fail. Generate one with `openssl rand -hex 32`.',
  );
};

const bootstrap = async (): Promise<void> => {
  const shutdownManager = createShutdownManager({
    logger,
    timeoutMs: config.http.shutdownTimeoutMs,
  });

  registerProcessSignalHandlers(shutdownManager, logger);

  warnAboutMissingAuthSecrets();

  await connectDatabaseWithRetry();
  shutdownManager.register({ name: 'database', run: disconnectDatabase });

  // Whether writes can be atomic depends on the deployment, so probe once and
  // warn now instead of discovering it during the first sale.
  await probeTransactionSupport();

  // Deferred work is set up before the port opens, so a reminder that came due
  // while the process was down is already being caught up on by the time the
  // first request arrives.
  registerDefaultNotificationProviders();
  // Storage is installed before the port opens, so a misconfigured image
  // directory fails at boot rather than at the first image somebody paid for.
  registerImageStorage();
  registerReminderJobs();
  await recoverPendingReminders();
  startScheduler();
  shutdownManager.register({ name: 'scheduler', run: stopScheduler });

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
      scheduler: registeredJobTypes(),
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
