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

const commaSeparatedList = z.preprocess(
  blankToUndefined,
  z.string().transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  ),
);

const optionalSecret = z.preprocess(blankToUndefined, z.string().min(1).optional());

const optionalUrl = z.preprocess(blankToUndefined, z.url().optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(NODE_ENVS).default('development'),

    API_HOST: z.string().min(1).default('127.0.0.1'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_BASE_PATH: z.string().startsWith('/').default('/api'),
    CORS_ORIGINS: commaSeparatedList.default(['http://localhost:5173']),
    BODY_LIMIT: z.string().min(1).default('1mb'),
    SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(0).default(10_000),
    TRUST_PROXY: booleanFromString.default(false),

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

    BILLZ_BASE_URL: optionalUrl,
    BILLZ_API_TOKEN: optionalSecret,
    OPENAI_API_KEY: optionalSecret,
    ANTHROPIC_API_KEY: optionalSecret,
    TELEGRAM_BOT_TOKEN: optionalSecret,
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
 * Parses the environment once at startup. A misconfigured process must fail
 * immediately and loudly rather than at the first request that needs the value.
 */
export const loadEnv = (): Env => {
  loadEnvFiles();

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error(`Invalid environment configuration:\n${formatIssues(result.error)}`);
    throw new Error('Invalid environment configuration');
  }

  return result.data;
};
