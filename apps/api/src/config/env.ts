import { AGENT_LIMITS, PENDING_ACTION_TTL_MS } from '@hadiya/shared';
import { z } from 'zod';

import { loadEnvFiles } from './load-env.js';

const NODE_ENVS = ['development', 'test', 'production'] as const;

/** Env values arrive as strings; `''` is treated as "not provided". */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const booleanFromString = z.preprocess(
  blankToUndefined,
  z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1'),
);

/**
 * A flag with a fallback.
 *
 * The fallback is applied in the preprocess step rather than with `.default()`:
 * a default sits *after* the pipe, so an unset variable would reach the inner
 * schema as `undefined` and fail validation instead of falling back.
 */
const booleanFromEnv = (fallback: boolean) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() !== ''
        ? value.trim().toLowerCase()
        : String(fallback),
    z.enum(['true', 'false', '1', '0']).transform((value) => value === 'true' || value === '1'),
  );

/** A comma-separated list with a fallback, applied for the same reason. */
const commaSeparatedList = (fallback: readonly string[] = []) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() !== '' ? value : fallback.join(',')),
    z.string().transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0),
    ),
  );

const optionalSecret = z.preprocess(blankToUndefined, z.string().min(1).optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_BASE_PATH: z.string().startsWith('/').default('/api'),
    CORS_ORIGINS: commaSeparatedList(['http://localhost:5173']),
    BODY_LIMIT: z.string().min(1).default('1mb'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    TRUST_PROXY: booleanFromEnv(false),

    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: booleanFromString.optional(),

    RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(300),

    MONGO_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/hadiya'),
    MONGO_MAX_POOL_SIZE: z.coerce.number().int().min(1).default(10),
    MONGO_SERVER_SELECTION_TIMEOUT_MS: z.coerce.number().int().min(100).default(5_000),

    JWT_ACCESS_SECRET: optionalSecret,
    JWT_REFRESH_SECRET: optionalSecret,
    JWT_ACCESS_TTL: z.string().min(1).default('15m'),
    JWT_REFRESH_TTL: z.string().min(1).default('30d'),

    // Both the in-repo legacy client and the published Billz v2 wrapper use
    // this host; it is overridable because Billz issues per-region hosts.
    BILLZ_BASE_URL: z.preprocess(blankToUndefined, z.url().default('https://api-admin.billz.ai')),
    BILLZ_API_TOKEN: optionalSecret,
    BILLZ_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(15_000),
    BILLZ_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    /** Restricts every read to these Billz shops. Empty means the whole company. */
    BILLZ_SHOP_IDS: commaSeparatedList(),
    OPENAI_API_KEY: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    /** Which vendor to use. Left unset, the configured key decides. */
    AI_PROVIDER: z.preprocess(blankToUndefined, z.enum(['openai', 'anthropic']).optional()),
    /** Overrides the provider's default model. */
    AI_MODEL: z.preprocess(blankToUndefined, z.string().min(1).max(80).optional()),
    AI_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
    AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),
    AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(256).max(32_000).default(4_096),

    /**
     * What one agent run may spend.
     *
     * These are the cost ceilings, and every one of them is a decision about
     * somebody's money rather than a tuning knob: a model that keeps asking for
     * tools spends a completion per round, and a workflow that fans out spends
     * an external call per tool. The defaults come from `AGENT_LIMITS` in the
     * shared package, which is also what a test pins; the variables exist so a
     * deployment can tighten them without a release.
     */
    AGENT_MAX_TOOL_ROUNDS: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(AGENT_LIMITS.maxToolRounds),
    AGENT_MAX_MODEL_CALLS: z.coerce
      .number()
      .int()
      .min(2)
      .max(30)
      .default(AGENT_LIMITS.maxModelCalls),
    AGENT_MAX_PARALLEL_TOOLS: z.coerce
      .number()
      .int()
      .min(1)
      .max(16)
      .default(AGENT_LIMITS.maxParallelTools),
    /** One tool call, retries included. A slow server cannot outlast this. */
    AGENT_TOOL_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(300_000)
      .default(AGENT_LIMITS.toolTimeoutMs),
    AGENT_MAX_TOOL_RETRIES: z.coerce
      .number()
      .int()
      .min(0)
      .max(5)
      .default(AGENT_LIMITS.maxToolRetries),
    AGENT_RETRY_BACKOFF_MS: z.coerce
      .number()
      .int()
      .min(0)
      .max(10_000)
      .default(AGENT_LIMITS.retryBackoffMs),
    AGENT_TOKEN_BUDGET: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(2_000_000)
      .default(AGENT_LIMITS.tokenBudget),
    /** How long a prepared action stands before the person has to be asked again. */
    AGENT_CONFIRMATION_TTL_MS: z.coerce
      .number()
      .int()
      .min(30_000)
      .max(24 * 60 * 60 * 1_000)
      .default(PENDING_ACTION_TTL_MS),
    /**
     * Whether a confirmed call must match an action Hadiya itself prepared.
     *
     * On, nothing that changes data runs unless this server asked for agreement
     * first and the arguments still match — the model saying "they agreed" is
     * not enough on its own. Off (the default), a confirmed call is still
     * checked against any prepared action that exists, and only the absence of
     * one is tolerated. It is a policy rather than a constant because tightening
     * it costs a turn whenever a model confirms in the same breath it proposes,
     * and that trade belongs to the deployment.
     */
    AGENT_REQUIRE_PENDING_CONFIRMATION: booleanFromEnv(false),

    /** Image generation. The vendor key is shared with the text model. */
    IMAGE_PROVIDER: z.preprocess(blankToUndefined, z.enum(['openai']).optional()),
    IMAGE_MODEL: z.preprocess(blankToUndefined, z.string().min(1).max(80).optional()),
    IMAGE_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
    /** An image takes far longer than a sentence; the default reflects that. */
    IMAGE_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(600_000).default(120_000),
    IMAGE_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),

    /** Where generated images are kept. `local` is disk; `s3` is not built yet. */
    STORAGE_DRIVER: z.preprocess(blankToUndefined, z.enum(['local']).default('local')),
    /** Relative paths resolve against the API package root. */
    STORAGE_LOCAL_DIR: z.string().min(1).default('storage'),
    /**
     * Speech to text. The transcription models share `OPENAI_API_KEY` with the
     * chat models, so configuring the assistant configures dictation too.
     */
    STT_PROVIDER: z.preprocess(blankToUndefined, z.enum(['openai']).optional()),
    STT_MODEL: z.preprocess(blankToUndefined, z.string().min(1).max(80).optional()),
    STT_BASE_URL: z.preprocess(blankToUndefined, z.url().optional()),
    /**
     * Left unset the provider detects the language, which is what a bilingual
     * shop floor needs. Set it to an ISO-639-1 code to pin one.
     */
    STT_LANGUAGE: z.preprocess(blankToUndefined, z.string().trim().min(2).max(5).optional()),
    /** Transcription is slower than a sentence and faster than an image. */
    STT_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(300_000).default(60_000),
    STT_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),

    TELEGRAM_BOT_TOKEN: optionalSecret,

    /**
     * The key integration credentials are encrypted with, 32 bytes as base64
     * or hex. Generate one with `openssl rand -base64 32`.
     *
     * Left unset outside production, storing a credential is refused rather
     * than done in the clear: a developer without a key gets a clear error on
     * the day they add an integration, not a database full of plaintext tokens
     * nobody noticed. In production it is required outright, below.
     */
    CREDENTIALS_ENCRYPTION_KEY: optionalSecret,

    /** How long an MCP handshake may take before it is abandoned. */
    MCP_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
    /** How long one MCP tool call may take. Caps how long a server can stall a turn. */
    MCP_TOOL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
    /**
     * Whether an MCP server may live on a private or loopback address.
     *
     * Off by default. Hadiya makes the outbound request, so a server URL is an
     * instruction to fetch a URL of the user's choosing from inside the
     * deployment's network — the classic way to reach a metadata endpoint or an
     * internal admin port. Local development needs it on; production must not.
     */
    MCP_ALLOW_PRIVATE_HOSTS: booleanFromEnv(false),

    /** Per-user Notion access tokens are stored; the API version is fixed here. */
    NOTION_API_VERSION: z.string().min(4).default('2022-06-28'),
    NOTION_BASE_URL: z.preprocess(blankToUndefined, z.url().default('https://api.notion.com')),
    NOTION_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(15_000),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== 'production') {
      return;
    }

    // Defaults that are convenient locally are unacceptable in production.
    const requiredSecrets = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;

    for (const key of requiredSecrets) {
      const secret = value[key];

      if (secret === undefined || secret.length < 32) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} must be set to at least 32 characters in production`,
        });
      }
    }

    if (value.CREDENTIALS_ENCRYPTION_KEY === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['CREDENTIALS_ENCRYPTION_KEY'],
        message:
          'CREDENTIALS_ENCRYPTION_KEY must be set in production; integration credentials cannot be stored without it',
      });
    }

    if (value.MCP_ALLOW_PRIVATE_HOSTS) {
      ctx.addIssue({
        code: 'custom',
        path: ['MCP_ALLOW_PRIVATE_HOSTS'],
        message:
          "MCP_ALLOW_PRIVATE_HOSTS must stay off in production: it lets a user-supplied server URL reach the deployment's own network",
      });
    }

    if (value.CORS_ORIGINS.length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'CORS_ORIGINS must list at least one allowed origin in production',
      });
    }
  });

export type Env = z.output<typeof envSchema>;

const formatIssues = (error: z.ZodError): string =>
  error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');

/**
 * Validates one set of variables. Pure, so the defaults and the production
 * rules can be tested without a file on disk or a mutated `process.env`.
 */
export const parseEnv = (source: Record<string, string | undefined>): Env => {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    console.error(`Invalid environment configuration:\n${formatIssues(result.error)}`);
    throw new Error('Invalid environment configuration');
  }

  return result.data;
};

/**
 * Parses the environment once at startup. A misconfigured process must fail
 * immediately and loudly rather than at the first request that needs the value.
 */
export const loadEnv = (): Env => {
  loadEnvFiles();

  return parseEnv(process.env);
};
