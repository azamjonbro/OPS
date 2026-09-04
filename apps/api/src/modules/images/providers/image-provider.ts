import type { ImageAspectRatio, ImageContentType, ImageQuality, ImageStyle } from '@hadiya/shared';

/**
 * The seam between "make me a picture" and whichever model actually does it.
 *
 * The image service knows nothing about OpenAI, its size strings or its
 * response envelope; it asks for a prompt at a ratio and gets bytes back.
 * Everything vendor-shaped lives behind this — including the decision of what
 * "16:9" means in pixels, which differs per model and will keep differing.
 *
 * A provider returns *bytes*, never a link. Some models answer with a URL that
 * expires within the hour, and an asset pointing at one would quietly become a
 * broken image in a plan written weeks earlier. Fetching and validating that
 * URL is the provider's job, because the provider is the only thing that knows
 * which host is legitimately its own.
 */

export interface ImageGenerationRequest {
  prompt: string;
  count: number;
  aspectRatio: ImageAspectRatio;
  quality?: ImageQuality | undefined;
  style?: ImageStyle | undefined;
}

export interface GeneratedImage {
  data: Buffer;
  contentType: ImageContentType;
  width: number;
  height: number;
  /** What the model rewrote the prompt to, when it says. */
  revisedPrompt: string | null;
}

export interface ImageGenerationResponse {
  images: GeneratedImage[];
  model: string;
}

export interface ImageProvider {
  readonly name: string;
  /** False when no credential is configured; generation then refuses clearly. */
  readonly isConfigured: boolean;
  readonly model: string;
  /**
   * How many images one call may produce. Some models take `n`, some insist on
   * one at a time; the service clamps to this and says so rather than silently
   * returning fewer than were asked for.
   */
  readonly maxImagesPerRequest: number;
  generate: (request: ImageGenerationRequest) => Promise<ImageGenerationResponse>;
}

let override: ImageProvider | null = null;
let cached: ImageProvider | null = null;

/** Testing seam: lets a suite supply a scripted provider. */
export const setImageProvider = (provider: ImageProvider | null): void => {
  override = provider;
  cached = null;
};

export const getImageProviderOverride = (): ImageProvider | null => override;

export const setCachedImageProvider = (provider: ImageProvider | null): void => {
  cached = provider;
};

export const getCachedImageProvider = (): ImageProvider | null => cached;
