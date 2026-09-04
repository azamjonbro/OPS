import { readFileSync } from 'node:fs';
import path from 'node:path';

import { loadEnv, type Env } from './env.js';
import { API_ROOT } from './paths.js';

export interface IntegrationConfig {
  /** True once every credential the integration needs is present. */
  configured: boolean;
}

export interface BillzConfig extends IntegrationConfig {
  baseUrl: string;
  apiToken: string | undefined;
  timeoutMs: number;
  maxRetries: number;
  /** Shops every read is restricted to; empty means the whole company. */
  shopIds: string[];
}

/** Which model answers, and how patiently. */
export interface AiConfig {
  /** Explicit choice, or `null` to let the configured key decide. */
  provider: 'openai' | 'anthropic' | null;
  /** Empty means the provider's own default. */
  model: string | null;
  baseUrl: string | null;
  timeoutMs: number;
  maxRetries: number;
  maxOutputTokens: number;
}

/** Which model draws, and how patiently. */
export interface ImageConfig {
  /** Explicit choice, or `null` to let the configured key decide. */
  provider: 'openai' | null;
  model: string;
  baseUrl: string | null;
  timeoutMs: number;
  maxRetries: number;
}

/** Where generated images are kept. */
export interface StorageConfig {
  driver: 'local';
  /** Absolute path on disk for the local driver. */
  localDir: string;
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
  ai: AiConfig;
  image: ImageConfig;
  storage: StorageConfig;
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
  ai: {
    provider: env.AI_PROVIDER ?? null,
    model: env.AI_MODEL ?? null,
    baseUrl: env.AI_BASE_URL ?? null,
    timeoutMs: env.AI_TIMEOUT_MS,
    maxRetries: env.AI_MAX_RETRIES,
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
  },
  image: {
    provider: env.IMAGE_PROVIDER ?? null,
    // The default is the current general-purpose image model; overridable so a
    // model upgrade is a configuration change.
    model: env.IMAGE_MODEL ?? 'gpt-image-1',
    baseUrl: env.IMAGE_BASE_URL ?? null,
    timeoutMs: env.IMAGE_TIMEOUT_MS,
    maxRetries: env.IMAGE_MAX_RETRIES,
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    // Resolved once, against the package root rather than the working
    // directory, so the location does not depend on where the process started.
    localDir: path.isAbsolute(env.STORAGE_LOCAL_DIR)
      ? env.STORAGE_LOCAL_DIR
      : path.join(API_ROOT, env.STORAGE_LOCAL_DIR),
  },
  integrations: {
    billz: {
      baseUrl: env.BILLZ_BASE_URL,
      apiToken: env.BILLZ_API_TOKEN,
      timeoutMs: env.BILLZ_TIMEOUT_MS,
      maxRetries: env.BILLZ_MAX_RETRIES,
      shopIds: env.BILLZ_SHOP_IDS,
      // The base URL has a default, so the token is what decides this.
      configured: Boolean(env.BILLZ_API_TOKEN),
    },
    openai: { apiKey: env.OPENAI_API_KEY, configured: Boolean(env.OPENAI_API_KEY) },
    anthropic: { apiKey: env.ANTHROPIC_API_KEY, configured: Boolean(env.ANTHROPIC_API_KEY) },
    telegram: { botToken: env.TELEGRAM_BOT_TOKEN, configured: Boolean(env.TELEGRAM_BOT_TOKEN) },
  },
});

/** The process-wide configuration, resolved once on first import. */
export const config: AppConfig = buildConfig();

export type { Env };
