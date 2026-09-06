import { readFileSync } from 'node:fs';
import path from 'node:path';

import { SPEECH_LANGUAGES } from '@hadiya/shared';

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

/** How far an OpenAI-shaped endpoint follows OpenAI. */
export type AiCompatibility = 'openai' | 'openai-compatible';

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
  /** Which request parameters the endpoint will accept. */
  compatibility: AiCompatibility;
}

/**
 * What one agent run may spend, and how strictly it asks before it acts.
 *
 * Every field is a ceiling rather than a target: a run that needs fewer rounds
 * uses fewer. They live in configuration because the right numbers depend on
 * the model, the plan and how patient the shop is, and none of that is knowable
 * from here.
 */
export interface AgentConfig {
  maxToolRounds: number;
  maxModelCalls: number;
  maxParallelTools: number;
  /** Calls one model response may contain, however few run at once. */
  maxToolCallsPerRound: number;
  toolTimeoutMs: number;
  maxToolRetries: number;
  retryBackoffMs: number;
  tokenBudget: number;
  confirmationTtlMs: number;
  /** Whether a confirmed call must match an action this server prepared. */
  requirePendingConfirmation: boolean;
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

/** Which model listens, and how patiently. */
export interface SpeechConfig {
  /** Explicit choice, or `null` to let the configured key decide. */
  provider: 'openai' | null;
  /** Transcription's own credential; falls back to the chat one. */
  apiKey: string | undefined;
  /** True once transcription has a credential from either source. */
  configured: boolean;
  model: string;
  baseUrl: string | null;
  /** `null` means let the provider detect it. */
  language: string | null;
  /** Languages a detected answer is checked against, primary first. */
  languages: readonly string[];
  timeoutMs: number;
  maxRetries: number;
  /** Recordings one account may transcribe per minute. */
  rateLimitMax: number;
}

/** How Hadiya talks to a user's own MCP server, and how patiently. */
export interface McpConfig {
  connectTimeoutMs: number;
  toolTimeoutMs: number;
  /** Whether a server URL may resolve to a private or loopback address. */
  allowPrivateHosts: boolean;
}

/** Where integration credentials are encrypted, and with what. */
export interface CredentialsConfig {
  /** Raw key material, 32 bytes; `null` when the deployment has not set one. */
  encryptionKey: string | null;
  /** True once a credential can actually be stored. */
  configured: boolean;
}

export interface NotionConfig {
  baseUrl: string;
  apiVersion: string;
  timeoutMs: number;
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
    /**
     * Per-endpoint ceilings the global limiter is too coarse to express: how
     * many wrong passwords, and how many requests that cost real money.
     */
    endpointLimits: {
      loginMax: number;
      chatMax: number;
      imageMax: number;
      uploadMax: number;
    };
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
  agent: AgentConfig;
  image: ImageConfig;
  speech: SpeechConfig;
  storage: StorageConfig;
  mcp: McpConfig;
  credentials: CredentialsConfig;
  integrations: {
    billz: BillzConfig;
    notion: NotionConfig;
    openai: IntegrationConfig & { apiKey: string | undefined };
    anthropic: IntegrationConfig & { apiKey: string | undefined };
    telegram: IntegrationConfig & { botToken: string | undefined };
  };
}

/**
 * Which dialect an endpoint speaks, when nobody has said.
 *
 * A base URL pointing away from OpenAI is the whole signal: somebody has
 * deliberately aimed this at another service, and the portable dialect is what
 * every other service accepts. Getting it wrong in this direction costs a
 * slightly older parameter name; getting it wrong the other way makes every
 * request fail with a message about an unknown field.
 */
const inferCompatibility = (baseUrl: string | undefined): AiCompatibility =>
  baseUrl && !/(^|\.)openai\.com/i.test(new URL(baseUrl).hostname) ? 'openai-compatible' : 'openai';

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
    endpointLimits: {
      loginMax: env.LOGIN_RATE_LIMIT_MAX,
      chatMax: env.CHAT_RATE_LIMIT_MAX,
      imageMax: env.IMAGE_RATE_LIMIT_MAX,
      uploadMax: env.UPLOAD_RATE_LIMIT_MAX,
    },
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
    compatibility: env.AI_COMPATIBILITY ?? inferCompatibility(env.AI_BASE_URL),
  },
  agent: {
    maxToolRounds: env.AGENT_MAX_TOOL_ROUNDS,
    maxModelCalls: env.AGENT_MAX_MODEL_CALLS,
    maxParallelTools: env.AGENT_MAX_PARALLEL_TOOLS,
    maxToolCallsPerRound: env.AGENT_MAX_TOOL_CALLS_PER_ROUND,
    toolTimeoutMs: env.AGENT_TOOL_TIMEOUT_MS,
    maxToolRetries: env.AGENT_MAX_TOOL_RETRIES,
    retryBackoffMs: env.AGENT_RETRY_BACKOFF_MS,
    tokenBudget: env.AGENT_TOKEN_BUDGET,
    confirmationTtlMs: env.AGENT_CONFIRMATION_TTL_MS,
    requirePendingConfirmation: env.AGENT_REQUIRE_PENDING_CONFIRMATION,
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
  speech: {
    provider: env.STT_PROVIDER ?? null,
    // Its own key when one is set, the chat key otherwise — so the common case
    // stays one credential in one place, and the split is available when the
    // two halves are best served by different vendors.
    apiKey: env.STT_API_KEY ?? env.OPENAI_API_KEY,
    configured: Boolean(env.STT_API_KEY ?? env.OPENAI_API_KEY),
    // Whisper is the model with documented Uzbek coverage, so it is the default
    // for a shop floor that speaks it; overridable for anywhere that does not.
    model: env.STT_MODEL ?? 'whisper-1',
    baseUrl: env.STT_BASE_URL ?? null,
    language: env.STT_LANGUAGE ?? null,
    languages: env.STT_LANGUAGES.length > 0 ? env.STT_LANGUAGES : SPEECH_LANGUAGES,
    timeoutMs: env.STT_TIMEOUT_MS,
    maxRetries: env.STT_MAX_RETRIES,
    rateLimitMax: env.STT_RATE_LIMIT_MAX,
  },
  storage: {
    driver: env.STORAGE_DRIVER,
    // Resolved once, against the package root rather than the working
    // directory, so the location does not depend on where the process started.
    localDir: path.isAbsolute(env.STORAGE_LOCAL_DIR)
      ? env.STORAGE_LOCAL_DIR
      : path.join(API_ROOT, env.STORAGE_LOCAL_DIR),
  },
  mcp: {
    connectTimeoutMs: env.MCP_CONNECT_TIMEOUT_MS,
    toolTimeoutMs: env.MCP_TOOL_TIMEOUT_MS,
    allowPrivateHosts: env.MCP_ALLOW_PRIVATE_HOSTS,
  },
  credentials: {
    encryptionKey: env.CREDENTIALS_ENCRYPTION_KEY ?? null,
    configured: Boolean(env.CREDENTIALS_ENCRYPTION_KEY),
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
    // Notion has no deployment-wide credential: each person connects their own
    // workspace, so `configured` is a property of the integration row, not of
    // the environment. Only the endpoint and its API version live here.
    notion: {
      baseUrl: env.NOTION_BASE_URL,
      apiVersion: env.NOTION_API_VERSION,
      timeoutMs: env.NOTION_TIMEOUT_MS,
    },
    openai: { apiKey: env.OPENAI_API_KEY, configured: Boolean(env.OPENAI_API_KEY) },
    anthropic: { apiKey: env.ANTHROPIC_API_KEY, configured: Boolean(env.ANTHROPIC_API_KEY) },
    telegram: { botToken: env.TELEGRAM_BOT_TOKEN, configured: Boolean(env.TELEGRAM_BOT_TOKEN) },
  },
});

/** The process-wide configuration, resolved once on first import. */
export const config: AppConfig = buildConfig();

export type { Env };
