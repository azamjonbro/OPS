import { config } from '../../../config/index.js';
import { ApiError } from '../../../core/http/api-error.js';
import {
  getCachedImageProvider,
  getImageProviderOverride,
  setCachedImageProvider,
  type ImageProvider,
} from './image-provider.js';
import { OpenAiImageProvider } from './openai-image.provider.js';

/** OpenAI's images endpoint lives under the same host as the chat one. */
const DEFAULT_IMAGE_BASE_URL = 'https://api.openai.com/v1';

/**
 * Stands in when no image model is configured.
 *
 * It refuses clearly rather than pretending: an asset row that claims to be
 * `completed` with no bytes behind it would be worse than an error, because a
 * plan would show a broken image and nobody would know why.
 */
export const createUnconfiguredImageProvider = (reason: string): ImageProvider => ({
  name: 'unconfigured',
  isConfigured: false,
  model: 'none',
  maxImagesPerRequest: 0,
  generate: () => {
    throw ApiError.dependencyUnavailable(`Image generation is not available: ${reason}`, {
      details: { integration: 'images', kind: 'not_configured' },
    });
  },
});

const build = (): ImageProvider => {
  const { openai } = config.integrations;

  // The image models share OpenAI's key with the text models, so configuring
  // the assistant configures this too — one credential, one place.
  if (!openai.configured) {
    return createUnconfiguredImageProvider('set OPENAI_API_KEY');
  }

  if (config.image.provider !== null && config.image.provider !== 'openai') {
    return createUnconfiguredImageProvider(
      `IMAGE_PROVIDER is set to ${String(config.image.provider)}, which is not implemented`,
    );
  }

  return new OpenAiImageProvider({
    apiKey: openai.apiKey ?? '',
    model: config.image.model,
    baseUrl: config.image.baseUrl ?? DEFAULT_IMAGE_BASE_URL,
    timeoutMs: config.image.timeoutMs,
    maxRetries: config.image.maxRetries,
  });
};

/**
 * The provider the image service uses. Built once, because a provider holds
 * only configuration and a `fetch`.
 */
export const getImageProvider = (): ImageProvider => {
  const override = getImageProviderOverride();

  if (override) {
    return override;
  }

  const cached = getCachedImageProvider();

  if (cached) {
    return cached;
  }

  const provider = build();
  setCachedImageProvider(provider);

  return provider;
};

/** What `/images/status` reports. Deliberately holds no credential. */
export interface ImageProviderStatus {
  provider: string;
  available: boolean;
  model: string | null;
  maxImagesPerRequest: number;
  storage: string;
  reason: string | null;
}

export const describeImageProvider = (): ImageProviderStatus => {
  const provider = getImageProvider();

  return {
    provider: provider.name,
    available: provider.isConfigured,
    model: provider.isConfigured ? provider.model : null,
    maxImagesPerRequest: provider.maxImagesPerRequest,
    storage: config.storage.driver,
    reason: provider.isConfigured ? null : 'no image model is configured',
  };
};

export { OpenAiImageProvider } from './openai-image.provider.js';
export {
  setImageProvider,
  type GeneratedImage,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
  type ImageProvider,
} from './image-provider.js';
