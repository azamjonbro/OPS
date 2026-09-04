import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ImageAspectRatio } from '@hadiya/shared';

import { AiProviderError } from '../ai/provider/ai-error.js';
import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageProvider,
} from './providers/image-provider.js';
import { LocalStorageProvider, setStorageProvider } from './storage/index.js';

/**
 * A scripted image model, for tests.
 *
 * Automated tests never call a paid image API: the service is written against
 * the provider interface, so a suite hands it a fixed answer — or a fixed
 * failure — and asserts on exactly what the service does with it.
 */

/** A one-pixel PNG. Real bytes, so storage and content types are exercised. */
export const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

export interface ScriptedImageProvider extends ImageProvider {
  /** Every request the service made, in order. */
  readonly requests: ImageGenerationRequest[];
}

export interface ScriptedImageOptions {
  /** Images produced per call. Defaults to whatever was asked for. */
  produce?: number;
  maxImagesPerRequest?: number;
  /** Thrown instead of answering, to exercise a failure path. */
  failWith?: Error;
  revisedPrompt?: string | null;
  model?: string;
  isConfigured?: boolean;
  /** Called before answering, so a test can assert on ordering. */
  onGenerate?: (request: ImageGenerationRequest) => void;
}

const image = (aspectRatio: ImageAspectRatio, revisedPrompt: string | null): GeneratedImage => ({
  data: PNG_PIXEL,
  contentType: 'image/png',
  width: aspectRatio === '16:9' ? 1536 : 1024,
  height: aspectRatio === '16:9' ? 1024 : 1024,
  revisedPrompt,
});

export const createScriptedImageProvider = (
  options: ScriptedImageOptions = {},
): ScriptedImageProvider => {
  const requests: ImageGenerationRequest[] = [];

  return {
    name: 'scripted',
    isConfigured: options.isConfigured ?? true,
    model: options.model ?? 'scripted-image-model',
    maxImagesPerRequest: options.maxImagesPerRequest ?? 4,
    requests,
    generate: async (request: ImageGenerationRequest): Promise<ImageGenerationResponse> => {
      requests.push(request);
      options.onGenerate?.(request);

      if (options.failWith) {
        throw options.failWith;
      }

      const count = options.produce ?? request.count;

      return {
        images: Array.from({ length: count }, () =>
          image(request.aspectRatio, options.revisedPrompt ?? null),
        ),
        model: options.model ?? 'scripted-image-model',
      };
    },
  };
};

/** The failure a provider raises when the upstream call times out. */
export const timeoutError = (): AiProviderError =>
  new AiProviderError('timeout', 'the provider did not respond within 120000ms');

/** A temporary directory installed as the storage driver for one suite. */
export interface TemporaryStorage {
  directory: string;
  cleanup: () => Promise<void>;
}

export const useTemporaryStorage = async (): Promise<TemporaryStorage> => {
  const directory = await mkdtemp(path.join(tmpdir(), 'hadiya-images-'));

  setStorageProvider(new LocalStorageProvider(directory));

  return {
    directory,
    cleanup: async () => {
      setStorageProvider(null);
      await rm(directory, { recursive: true, force: true });
    },
  };
};
