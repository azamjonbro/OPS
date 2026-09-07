import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildConfig } from './index.js';
import type { Env } from './env.js';

const baseEnv: Env = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 4000,
  API_BASE_PATH: '/api',
  CORS_ORIGINS: ['http://localhost:5173'],
  BODY_LIMIT: '1mb',
  SHUTDOWN_TIMEOUT_MS: 10_000,
  TRUST_PROXY: false,
  LOG_LEVEL: 'silent',
  LOG_PRETTY: false,
  RATE_LIMIT_WINDOW_MS: 60_000,
  RATE_LIMIT_MAX: 300,
  LOGIN_RATE_LIMIT_MAX: 10,
  CHAT_RATE_LIMIT_MAX: 30,
  IMAGE_RATE_LIMIT_MAX: 10,
  UPLOAD_RATE_LIMIT_MAX: 30,
  MONGO_URI: 'mongodb://127.0.0.1:27017/hadiya-test',
  MONGO_MAX_POOL_SIZE: 10,
  MONGO_SERVER_SELECTION_TIMEOUT_MS: 5_000,
  JWT_ACCESS_SECRET: undefined,
  JWT_REFRESH_SECRET: undefined,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  BILLZ_BASE_URL: 'https://api-admin.billz.ai',
  BILLZ_API_TOKEN: undefined,
  BILLZ_TIMEOUT_MS: 15_000,
  BILLZ_MAX_RETRIES: 2,
  BILLZ_SHOP_IDS: [],
  OPENAI_API_KEY: undefined,
  AI_PROVIDER: undefined,
  AI_MODEL: undefined,
  AI_BASE_URL: undefined,
  AI_TIMEOUT_MS: 60_000,
  AI_MAX_RETRIES: 2,
  AI_MAX_OUTPUT_TOKENS: 4_096,
  ANTHROPIC_API_KEY: undefined,
  TELEGRAM_BOT_TOKEN: undefined,
  STT_PROVIDER: undefined,
  STT_MODEL: undefined,
  STT_BASE_URL: undefined,
  STT_LANGUAGE: undefined,
  STT_TIMEOUT_MS: 60_000,
  STT_MAX_RETRIES: 1,
  IMAGE_PROVIDER: undefined,
  IMAGE_MODEL: undefined,
  IMAGE_BASE_URL: undefined,
  IMAGE_TIMEOUT_MS: 120_000,
  IMAGE_MAX_RETRIES: 1,
  STORAGE_DRIVER: 'local',
  STORAGE_LOCAL_DIR: 'storage',
  CREDENTIALS_ENCRYPTION_KEY: undefined,
  MCP_CONNECT_TIMEOUT_MS: 10_000,
  MCP_TOOL_TIMEOUT_MS: 30_000,
  MCP_ALLOW_PRIVATE_HOSTS: false,
  NOTION_API_VERSION: '2022-06-28',
  NOTION_BASE_URL: 'https://api.notion.com',
  NOTION_TIMEOUT_MS: 15_000,
  STT_API_KEY: undefined,
  STT_LANGUAGES: [],
  STT_RATE_LIMIT_MAX: 20,
  AGENT_MAX_TOOL_ROUNDS: 6,
  AGENT_MAX_MODEL_CALLS: 8,
  AGENT_MAX_PARALLEL_TOOLS: 4,
  AGENT_MAX_TOOL_CALLS_PER_ROUND: 12,
  AGENT_TOOL_TIMEOUT_MS: 45_000,
  AGENT_MAX_TOOL_RETRIES: 2,
  AGENT_RETRY_BACKOFF_MS: 250,
  AGENT_TOKEN_BUDGET: 120_000,
  AGENT_CONFIRMATION_TTL_MS: 600_000,
  AGENT_REQUIRE_PENDING_CONFIRMATION: false,
};

describe('buildConfig', () => {
  it('derives environment flags from NODE_ENV', () => {
    const built = buildConfig({ ...baseEnv, NODE_ENV: 'production' });

    expect(built.app.isProduction).toBe(true);
    expect(built.app.isDevelopment).toBe(false);
  });

  it('treats Billz as unconfigured until the secret token is present', () => {
    // The host has a working default, so the token is the only thing missing.
    expect(buildConfig(baseEnv).integrations.billz.configured).toBe(false);
    expect(
      buildConfig({ ...baseEnv, BILLZ_API_TOKEN: 'secret' }).integrations.billz.configured,
    ).toBe(true);
  });

  it('keeps the documented Billz host as the default', () => {
    expect(buildConfig(baseEnv).integrations.billz.baseUrl).toBe('https://api-admin.billz.ai');
  });

  it('reports a real package version', () => {
    expect(buildConfig(baseEnv).app.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('loadEnv', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('applies every default when nothing at all is set', async () => {
    const { parseEnv } = await import('./env.js');

    // A fresh deployment sets only what it must; everything else has to fall
    // back rather than fail validation.
    const env = parseEnv({ NODE_ENV: 'test' });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.TRUST_PROXY).toBe(false);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.BILLZ_SHOP_IDS).toEqual([]);
    expect(env.BILLZ_BASE_URL).toBe('https://api-admin.billz.ai');
    expect(env.BILLZ_MAX_RETRIES).toBe(2);
  });

  it('reads a comma-separated list into trimmed entries', async () => {
    const { parseEnv } = await import('./env.js');

    expect(
      parseEnv({ NODE_ENV: 'test', BILLZ_SHOP_IDS: 'shop-1, shop-2 ,' }).BILLZ_SHOP_IDS,
    ).toEqual(['shop-1', 'shop-2']);
  });

  it('rejects a production environment without JWT secrets', async () => {
    const { loadEnv } = await import('./env.js');

    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'too-short';
    process.env.JWT_REFRESH_SECRET = '';

    expect(() => loadEnv()).toThrow(/Invalid environment configuration/);
  });
});

/**
 * What production must not be allowed to inherit from a developer's machine.
 *
 * Every variable here has a fallback, which is what makes local setup one
 * command — and what made two of them dangerous. An unset `CORS_ORIGINS` became
 * `http://localhost:5173`, so the old "at least one origin" rule could never
 * fire and production trusted a development origin. An unset `MONGO_URI` became
 * the development database, so a deployment that forgot it looked healthy while
 * writing a shop's real data somewhere nobody backs up.
 */
describe('production may not fall back to development values', () => {
  const productionEnv = (overrides: Record<string, string> = {}): Record<string, string> => ({
    NODE_ENV: 'production',
    JWT_ACCESS_SECRET: 'a'.repeat(48),
    JWT_REFRESH_SECRET: 'b'.repeat(48),
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    MONGO_URI: 'mongodb://db.internal:27017/hadiya',
    CORS_ORIGINS: 'https://shop.example',
    ...overrides,
  });

  it('accepts a properly configured production environment', async () => {
    const { parseEnv } = await import('./env.js');

    expect(() => parseEnv(productionEnv())).not.toThrow();
    // Two origins, and Mongo reached over loopback on the same host, are both
    // ordinary production arrangements and must keep working.
    expect(() =>
      parseEnv(
        productionEnv({
          CORS_ORIGINS: 'https://shop.example,https://www.shop.example',
          MONGO_URI: 'mongodb://127.0.0.1:27017/hadiya-prod',
        }),
      ),
    ).not.toThrow();
  });

  it('refuses the development database, however it was arrived at', async () => {
    const { parseEnv } = await import('./env.js');
    const { MONGO_URI: _omitted, ...withoutMongo } = productionEnv();

    expect(() => parseEnv(withoutMongo)).toThrow(/Invalid environment configuration/);
    expect(() =>
      parseEnv(productionEnv({ MONGO_URI: 'mongodb://127.0.0.1:27017/hadiya' })),
    ).toThrow(/Invalid environment configuration/);
  });

  it('refuses a development origin, a wildcard, and cleartext', async () => {
    const { parseEnv } = await import('./env.js');
    const { CORS_ORIGINS: _omitted, ...withoutCors } = productionEnv();

    // Unset and empty both land on the development origin.
    expect(() => parseEnv(withoutCors)).toThrow(/Invalid environment configuration/);
    expect(() => parseEnv(productionEnv({ CORS_ORIGINS: '' }))).toThrow(
      /Invalid environment configuration/,
    );

    for (const origin of [
      'http://localhost:5173',
      'https://localhost',
      'https://127.0.0.1',
      '*',
      'http://shop.example',
      'shop.example',
    ]) {
      expect(() => parseEnv(productionEnv({ CORS_ORIGINS: origin }))).toThrow(
        /Invalid environment configuration/,
      );
    }

    // One bad origin in a list of good ones is still a bad list.
    expect(() =>
      parseEnv(productionEnv({ CORS_ORIGINS: 'https://shop.example,http://localhost:5173' })),
    ).toThrow(/Invalid environment configuration/);
  });

  it('leaves development and test alone, so local setup stays one command', async () => {
    const { parseEnv } = await import('./env.js');

    for (const NODE_ENV of ['development', 'test'] as const) {
      const env = parseEnv({ NODE_ENV });

      expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
      expect(env.MONGO_URI).toBe('mongodb://127.0.0.1:27017/hadiya');
    }
  });
});
