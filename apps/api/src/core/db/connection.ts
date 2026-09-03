import mongoose from 'mongoose';

import { config } from '../../config/index.js';
import { createLogger } from '../logger/logger.js';

const log = createLogger('mongo');

export type DatabaseState = 'disconnected' | 'connected' | 'connecting' | 'disconnecting';

const READY_STATES: Record<number, DatabaseState> = {
  0: 'disconnected',
  1: 'connected',
  2: 'connecting',
  3: 'disconnecting',
};

export interface DatabaseProbe {
  state: DatabaseState;
  /** Round-trip time of an `admin.ping()`, when the connection is usable. */
  latencyMs?: number;
  error?: string;
}

let listenersAttached = false;

const attachConnectionListeners = (): void => {
  if (listenersAttached) {
    return;
  }

  mongoose.connection.on('connected', () => log.info('database connected'));
  mongoose.connection.on('disconnected', () => log.warn('database disconnected'));
  mongoose.connection.on('reconnected', () => log.info('database reconnected'));
  mongoose.connection.on('error', (error: Error) => log.error({ err: error }, 'database error'));

  listenersAttached = true;
};

/**
 * Opens the connection pool. The driver keeps retrying in the background after
 * the first successful handshake, so this is only about the initial connect.
 */
export const connectDatabase = async (): Promise<void> => {
  attachConnectionListeners();

  // Reject writes that reference fields absent from the schema.
  mongoose.set('strictQuery', true);

  await mongoose.connect(config.database.uri, {
    maxPoolSize: config.database.maxPoolSize,
    serverSelectionTimeoutMS: config.database.serverSelectionTimeoutMs,
    autoIndex: !config.app.isProduction,
  });
};

export const disconnectDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState === 0) {
    return;
  }

  await mongoose.connection.close(false);
};

export const getDatabaseState = (): DatabaseState =>
  READY_STATES[mongoose.connection.readyState] ?? 'disconnected';

/** Actively verifies the connection instead of trusting the cached state. */
export const probeDatabase = async (): Promise<DatabaseProbe> => {
  const state = getDatabaseState();

  if (state !== 'connected') {
    return { state };
  }

  const startedAt = performance.now();

  try {
    await mongoose.connection.db?.admin().ping();

    return { state, latencyMs: Math.round((performance.now() - startedAt) * 100) / 100 };
  } catch (error) {
    return {
      state: 'disconnected',
      error: error instanceof Error ? error.message : 'ping failed',
    };
  }
};
