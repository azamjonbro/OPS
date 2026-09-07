import { randomBytes } from 'node:crypto';

import { defineConfig } from 'vitest/config';

/**
 * Integration tests run against a real MongoDB, never a mock: the behaviour
 * under test (unique indexes, conditional stock updates, transactions) only
 * exists in the database. Point `MONGO_TEST_URI` at a replica set to exercise
 * the transactional paths; a standalone server runs the same tests through the
 * non-transactional fallback.
 */
const BASE_URI =
  process.env.MONGO_TEST_URI ?? 'mongodb://127.0.0.1:27018/hadiya-test?replicaSet=rs0';

/**
 * A database of this run's own.
 *
 * Every file empties every collection in `beforeEach`, which is the right way
 * to isolate one test from the next *within* a run and a loaded gun pointed at
 * anything else using the same database. A second run — a watch-mode window
 * left open, a colleague on the same machine, two CI jobs on one Mongo, a
 * developer running one file while the whole suite goes — deletes rows out from
 * under the first one mid-test.
 *
 * That failed rarely and moved around: whichever test happened to be holding a
 * row when somebody else's `deleteMany` landed. It looked like flakiness in a
 * dozen unrelated files and was one shared mutable resource. Reproduced by
 * running the suite twice at once: 22 failures in 25 attempts, against 0 in 25
 * when run alone.
 *
 * So the name carries a per-run suffix. Concurrent runs no longer collide, and
 * `globalSetup` drops the database afterwards so they do not accumulate. The
 * suffix is appended to whatever `MONGO_TEST_URI` names rather than replacing
 * it, so a deployment keeps its host, credentials and options — and gets the
 * isolation whether or not it thought to ask for it.
 */
const withRunSuffix = (uri: string): string => {
  const url = new URL(uri);
  const database = url.pathname.replace(/^\//, '') || 'hadiya-test';

  url.pathname = `/${database}-${process.pid}-${randomBytes(3).toString('hex')}`;

  return url.toString();
};

const TEST_DATABASE_URI = withRunSuffix(BASE_URI);

/**
 * The same URI, on the runner's own environment.
 *
 * `env` below reaches the worker processes; `globalSetup` runs in this one and
 * is handed nothing, so the teardown that drops the database would otherwise
 * have no way to learn its name. This config module is evaluated once, here, in
 * the process that will run it — which makes this the one place both sides can
 * see. It is deliberately not called `MONGO_URI`: nothing in the runner should
 * connect to it by accident.
 */
process.env.HADIYA_TEST_DATABASE_URI = TEST_DATABASE_URI;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Drops this run's database when every worker has finished.
    globalSetup: ['./src/test/global-setup.ts'],
    // Files share this run's database, so they must not run at the same time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      MONGO_URI: TEST_DATABASE_URI,
      MONGO_SERVER_SELECTION_TIMEOUT_MS: '3000',
      // The whole suite runs in one process, from one address, so every test
      // file shares the global limiter's window — and the security suite spends
      // hundreds of requests on purpose. Raised so one file's deliberate flood
      // cannot fail an unrelated file's ordinary request. The limiter itself is
      // tested directly, against a ceiling that test sets.
      RATE_LIMIT_MAX: '100000',
      // Likewise the per-endpoint budgets, whose own tests set what they need.
      LOGIN_RATE_LIMIT_MAX: '10',
      CHAT_RATE_LIMIT_MAX: '20',
      IMAGE_RATE_LIMIT_MAX: '1000',
      UPLOAD_RATE_LIMIT_MAX: '20',
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
      // Dictation's per-account limit is a billing control, and a suite that
      // uploads a burst of scripted recordings should not be racing it. The
      // limiter itself is tested directly, with a ceiling it sets.
      STT_RATE_LIMIT_MAX: '1000',
      // Pointed at a domain that does not resolve, so a Notion test that forgot
      // to stub `fetch` fails loudly instead of reaching Notion.
      NOTION_BASE_URL: 'https://api.notion.test',
      NOTION_TIMEOUT_MS: '2000',
    },
  },
});
