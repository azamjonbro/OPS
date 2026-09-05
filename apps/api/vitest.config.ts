import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real MongoDB, never a mock: the behaviour
 * under test (unique indexes, conditional stock updates, transactions) only
 * exists in the database. Point `MONGO_TEST_URI` at a replica set to exercise
 * the transactional paths; a standalone server runs the same tests through the
 * non-transactional fallback.
 */
const TEST_DATABASE_URI =
  process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27018/hadiya-test?replicaSet=rs0';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Test files share one database, so they must not run at the same time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGO_URI: TEST_DATABASE_URI,
      MONGO_SERVER_SELECTION_TIMEOUT_MS: '3000',
      // Test-only signing keys; production start-up requires real ones.
      JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-32',
      JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough-32',
      // Billz is pinned to obviously fake values so a developer's real
      // credentials in .env can never leak into a test run, and so nothing here
      // can reach the production Billz API even by accident. Every Billz test
      // injects its own scripted `fetch`.
      // No AI credential reaches a test run. The provider factory then returns
      // the unconfigured provider, so the suite can never spend money or touch
      // a model API; every AI test injects its own scripted provider instead.
      OPENAI_API_KEY: '',
      ANTHROPIC_API_KEY: '',
      AI_PROVIDER: '',
      AI_MODEL: '',
      AI_BASE_URL: 'https://ai-provider.test/v1',
      AI_TIMEOUT_MS: '2000',
      AI_MAX_RETRIES: '0',
      BILLZ_BASE_URL: 'https://api-admin.billz.test',
      BILLZ_API_TOKEN: 'test-billz-secret-token',
      BILLZ_SHOP_IDS: '',
      BILLZ_TIMEOUT_MS: '5000',
      BILLZ_MAX_RETRIES: '0',
      // A fixed, obviously-fake key. Credential tests need encryption to work;
      // they must never depend on a developer's real one, and a committed key
      // guarantees a test can never decrypt anything but its own fixtures.
      CREDENTIALS_ENCRYPTION_KEY: 'aGFkaXlhLXRlc3Qtb25seS1rZXktMzItYnl0ZXMhISE=',
      // MCP tests inject a scripted client, so nothing here dials out. Private
      // hosts stay refused so the URL guard is exercised as it ships.
      MCP_ALLOW_PRIVATE_HOSTS: 'false',
      MCP_CONNECT_TIMEOUT_MS: '2000',
      MCP_TOOL_TIMEOUT_MS: '2000',
      // Pointed at a domain that does not resolve, so a Notion test that forgot
      // to stub `fetch` fails loudly instead of reaching Notion.
      NOTION_BASE_URL: 'https://api.notion.test',
      NOTION_TIMEOUT_MS: '2000',
    },
  },
});
