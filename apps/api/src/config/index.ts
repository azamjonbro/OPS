import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnv, type Env } from './env.js';
import { API_ROOT } from './paths.js';

export interface IntegrationConfig {
  /** True once every credential the integration needs is present. */
  configured: boolean;
}

export interface BillzConfig extends IntegrationConfig {
  baseUrl: string | undefined;
  apiToken: string | undefined;
}

export interface AppConfig {
  app: {
    name: string;
    version: string;
    env: Env['NODE_ENV'];
    isProduction: boolean;
    isDevelopment: boolean;
    isTest: boolean;
  };
  http: {
    host: string;
    port: number;
    basePath: string;
    corsOrigins: string[];
    bodyLimit: string;
    trustProxy: boolean;
    shutdownTimeoutMs: number;
    rateLimit: { windowMs: number; max: number };
  };
  log: {
    level: Env['LOG_LEVEL'];
    pretty: boolean;
  };
  database: {
    uri: string;
    maxPoolSize: number;
    serverSelectionTimeoutMs: number;
  };
  auth: {
    accessSecret: string | undefined;
    refreshSecret: string | undefined;
    accessTtl: string;
    refreshTtl: string;
  };
  /**
   * Credentials for capabilities delivered in later phases. Configuration is
   * read here so a module can be switched on without touching the bootstrap;
   * none of these integrations are implemented yet.
   */
  integrations: {
    billz: BillzConfig;
    openai: IntegrationConfig & { apiKey: string | undefined };
    anthropic: IntegrationConfig & { apiKey: string | undefined };
    telegram: IntegrationConfig & { botToken: string | undefined };
  };
}

const readPackageVersion = (): string => {
  try {
    const manifest: unknown = JSON.parse(readFileSync(path.join(API_ROOT, 'package.json'), 'utf8'));

    if (typeof manifest === 'object' && manifest !== null && 'version' in manifest) {
      const { version } = manifest as { version?: unknown };

      if (typeof version === 'string') {
        return version;
      }
    }
  } catch {
    // A missing or unreadable manifest must not stop the service from booting.
  }

  return '0.0.0';
};

export const buildConfig = (env: Env = loadEnv()): AppConfig => ({
  app: {
    name: 'hadiya-api',
    version: readPackageVersion(),
    env: env.NODE_ENV,
    isProduction: env.NODE_ENV === 'production',
    isDevelopment: env.NODE_ENV === 'development',
    isTest: env.NODE_ENV === 'test',
  },
  http: {
    host: env.API_HOST,
    port: env.API_PORT,
    basePath: env.API_BASE_PATH,
    corsOrigins: env.CORS_ORIGINS,
    bodyLimit: env.BODY_LIMIT,
    trustProxy: env.TRUST_PROXY,
    shutdownTimeoutMs: env.SHUTDOWN_TIMEOUT_MS,
    rateLimit: { windowMs: env.RATE_LIMIT_WINDOW_MS, max: env.RATE_LIMIT_MAX },
  },
  log: {
    level: env.LOG_LEVEL,
    pretty: env.LOG_PRETTY ?? env.NODE_ENV === 'development',
  },
  database: {
    uri: env.MONGO_URI,
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    serverSelectionTimeoutMs: env.MONGO_SERVER_SELECTION_TIMEOUT_MS,
  },
  auth: {
    accessSecret: env.JWT_ACCESS_SECRET,
    refreshSecret: env.JWT_REFRESH_SECRET,
    accessTtl: env.JWT_ACCESS_TTL,
    refreshTtl: env.JWT_REFRESH_TTL,
  },
  integrations: {
    billz: {
      baseUrl: env.BILLZ_BASE_URL,
      apiToken: env.BILLZ_API_TOKEN,
      configured: Boolean(env.BILLZ_BASE_URL && env.BILLZ_API_TOKEN),
    },
    openai: { apiKey: env.OPENAI_API_KEY, configured: Boolean(env.OPENAI_API_KEY) },
    anthropic: { apiKey: env.ANTHROPIC_API_KEY, configured: Boolean(env.ANTHROPIC_API_KEY) },
    telegram: { botToken: env.TELEGRAM_BOT_TOKEN, configured: Boolean(env.TELEGRAM_BOT_TOKEN) },
  },
});

/** The process-wide configuration, resolved once on first import. */
export const config: AppConfig = buildConfig();

export type { Env };
