import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/http/api-error.js';
import { AnthropicProvider } from './anthropic.provider.js';
import { OpenAiProvider } from './openai.provider.js';
import type { AiProvider } from './ai-provider.js';

/**
 * Defaults chosen for what this assistant actually does: hold a conversation,
 * pick the right tool, and reason over business figures across several steps.
 * Both are overridable with `AI_MODEL`, so upgrading a model is a config change.
 */
export const DEFAULT_MODELS = {
  openai: 'gpt-5',
  anthropic: 'claude-opus-5',
} as const;

export const DEFAULT_BASE_URLS = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
} as const;

export type AiProviderName = keyof typeof DEFAULT_MODELS;

/**
 * Stands in when no model is configured.
 *
 * It refuses clearly rather than pretending to answer: a canned reply would
 * look like a working assistant and quietly poison conversation history with
 * text no model produced.
 */
export const createUnconfiguredProvider = (reason: string): AiProvider => ({
  name: 'unconfigured',
  isConfigured: false,
  complete: () => {
    throw ApiError.dependencyUnavailable(`The AI assistant is not available: ${reason}`, {
      details: { integration: 'ai', kind: 'not_configured' },
    });
  },
});

let override: AiProvider | null = null;
let cached: AiProvider | null = null;

/** Testing seam: lets a suite supply a scripted provider. */
export const setAiProvider = (provider: AiProvider | null): void => {
  override = provider;
  cached = null;
};

/**
 * Which vendor to use: the explicit choice when there is one, otherwise
 * whichever key is present. With both keys and no choice, OpenAI wins — an
 * arbitrary but fixed rule, so behaviour never depends on env ordering.
 */
export const resolveProviderName = (): AiProviderName | null => {
  const { openai, anthropic } = config.integrations;
  const requested = config.ai.provider;

  if (requested === 'openai') {
    return openai.configured ? 'openai' : null;
  }

  if (requested === 'anthropic') {
    return anthropic.configured ? 'anthropic' : null;
  }

  if (openai.configured) {
    return 'openai';
  }

  return anthropic.configured ? 'anthropic' : null;
};

const build = (): AiProvider => {
  const name = resolveProviderName();

  if (!name) {
    const requested = config.ai.provider;

    return createUnconfiguredProvider(
      requested
        ? `AI_PROVIDER is set to ${requested} but its API key is missing`
        : 'set OPENAI_API_KEY or ANTHROPIC_API_KEY',
    );
  }

  const shared = {
    model: config.ai.model ?? DEFAULT_MODELS[name],
    baseUrl: config.ai.baseUrl ?? DEFAULT_BASE_URLS[name],
    timeoutMs: config.ai.timeoutMs,
    maxRetries: config.ai.maxRetries,
    maxOutputTokens: config.ai.maxOutputTokens,
  };

  if (name === 'anthropic') {
    // Non-null: `resolveProviderName` only returns a vendor whose key is set.
    return new AnthropicProvider({
      apiKey: config.integrations.anthropic.apiKey ?? '',
      ...shared,
    });
  }

  return new OpenAiProvider({ apiKey: config.integrations.openai.apiKey ?? '', ...shared });
};

/**
 * The provider the agent uses. Built once, because a provider holds only
 * configuration and a `fetch`, and rebuilding it per request would re-read
 * config on a hot path for nothing.
 */
export const getAiProvider = (): AiProvider => {
  if (override) {
    return override;
  }

  cached ??= build();

  return cached;
};

/** What `/ai/status` reports. Deliberately holds no credential. */
export interface AiProviderStatus {
  provider: string;
  available: boolean;
  model: string | null;
  reason: string | null;
}

export const describeAiProvider = (): AiProviderStatus => {
  const provider = getAiProvider();
  const name = resolveProviderName();

  if (!provider.isConfigured) {
    return {
      provider: provider.name,
      available: false,
      model: null,
      reason: config.ai.provider
        ? `AI_PROVIDER is ${config.ai.provider} but its API key is missing`
        : 'no AI API key is configured',
    };
  }

  return {
    provider: provider.name,
    available: true,
    model: config.ai.model ?? (name ? DEFAULT_MODELS[name] : null),
    reason: null,
  };
};

export { AnthropicProvider } from './anthropic.provider.js';
export { OpenAiProvider } from './openai.provider.js';
export { AiProviderError, isAiProviderError } from './ai-error.js';
export type { AiErrorKind } from './ai-error.js';
export type {
  AiCompletion,
  AiCompletionRequest,
  AiPromptMessage,
  AiProvider,
  AiToolCallRequest,
  AiToolDefinition,
} from './ai-provider.js';
