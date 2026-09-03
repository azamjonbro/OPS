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
  MONGO_URI: 'mongodb://127.0.0.1:27017/hadiya-test',
  MONGO_MAX_POOL_SIZE: 10,
  MONGO_SERVER_SELECTION_TIMEOUT_MS: 5_000,
  JWT_ACCESS_SECRET: undefined,
  JWT_REFRESH_SECRET: undefined,
  JWT_ACCESS_TTL: '15m',
  JWT_REFRESH_TTL: '30d',
  BILLZ_BASE_URL: undefined,
  BILLZ_API_TOKEN: undefined,
  OPENAI_API_KEY: undefined,
  ANTHROPIC_API_KEY: undefined,
  TELEGRAM_BOT_TOKEN: undefined,
};

describe('buildConfig', () => {
  it('derives environment flags from NODE_ENV', () => {
    const built = buildConfig({ ...baseEnv, NODE_ENV: 'production' });

    expect(built.app.isProduction).toBe(true);
    expect(built.app.isDevelopment).toBe(false);
  });

  it('marks an integration as unconfigured until every credential is present', () => {
    expect(buildConfig(baseEnv).integrations.billz.configured).toBe(false);
    expect(
      buildConfig({ ...baseEnv, BILLZ_BASE_URL: 'https://api.billz.test' }).integrations.billz
        .configured,
    ).toBe(false);
    expect(
      buildConfig({
        ...baseEnv,
        BILLZ_BASE_URL: 'https://api.billz.test',
        BILLZ_API_TOKEN: 'token',
      }).integrations.billz.configured,
    ).toBe(true);
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

  it('rejects a production environment without JWT secrets', async () => {
    const { loadEnv } = await import('./env.js');

    process.env.NODE_ENV = 'production';
    process.env.JWT_ACCESS_SECRET = 'too-short';
    process.env.JWT_REFRESH_SECRET = '';

    expect(() => loadEnv()).toThrow(/Invalid environment configuration/);
  });
});
