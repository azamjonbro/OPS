import {
  IMAGE_CONTENT_TYPES,
  IMAGE_MAX_BYTES,
  IMAGE_STYLE_GUIDANCE,
  type ImageAspectRatio,
  type ImageContentType,
} from '@hadiya/shared';
import type { Logger } from 'pino';

import { createLogger } from '../../../core/logger/logger.js';
import { AiProviderError } from '../../ai/provider/ai-error.js';
import { postJson, type FetchLike } from '../../ai/provider/ai-http.js';
import type {
  GeneratedImage,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageProvider,
} from './image-provider.js';

/** OpenAI's images wire format, only as far as this provider uses it. */
interface OpenAiImageItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

interface OpenAiImageResponse {
  created?: number;
  data?: OpenAiImageItem[];
  model?: string;
}

export interface OpenAiImageProviderOptions {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: FetchLike;
  logger?: Logger;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Sizes, per model.
 *
 * The two families accept different strings and reject anything else outright,
 * so the mapping lives here rather than in a shared constant that would be
 * wrong for one of them. Ratios that no model offers exactly are mapped to the
 * nearest supported shape — a 4:5 request becomes the tallest portrait
 * available, which is what the person wanted and is closer than a square.
 */
const GPT_IMAGE_SIZES: Record<ImageAspectRatio, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1536',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
  '3:2': '1536x1024',
};

const DALL_E_3_SIZES: Record<ImageAspectRatio, string> = {
  '1:1': '1024x1024',
  '4:5': '1024x1792',
  '9:16': '1024x1792',
  '16:9': '1792x1024',
  '3:2': '1792x1024',
};

const isDallE = (model: string): boolean => model.startsWith('dall-e');

const parseSize = (size: string): { width: number; height: number } => {
  const [width, height] = size.split('x').map((part) => Number.parseInt(part, 10));

  return { width: width ?? 1024, height: height ?? 1024 };
};

/**
 * The style is appended to the prompt rather than sent as a parameter.
 *
 * `dall-e-3` has a two-value `style` field and `gpt-image-1` has none, so
 * neither expresses what Hadiya means by "studio" or "minimal". Saying it in
 * words works on every model and is visible in the stored prompt, which is what
 * somebody debugging a bad image will read.
 */
const composePrompt = (request: ImageGenerationRequest): string =>
  request.style ? `${request.prompt}\n\n${IMAGE_STYLE_GUIDANCE[request.style]}` : request.prompt;

/**
 * Fetches an image the provider answered with a link to.
 *
 * Every part of this is a check, because a URL from an upstream response is not
 * trusted input just because the response was authenticated: the scheme must be
 * https, the host must be one OpenAI actually serves images from, the content
 * type must be an image type this system stores, and the body must be within
 * the size cap — read from the buffer, not from a header a server can lie about.
 */
const ALLOWED_IMAGE_HOSTS = [
  'oaidalleapiprodscus.blob.core.windows.net',
  'openaiapi-site.azureedge.net',
  'videos.openai.com',
];

const isAllowedHost = (hostname: string): boolean =>
  ALLOWED_IMAGE_HOSTS.includes(hostname) ||
  hostname.endsWith('.blob.core.windows.net') ||
  hostname.endsWith('.openai.com');

const fetchImageBytes = async (
  rawUrl: string,
  fetchImpl: FetchLike,
  timeoutMs: number,
): Promise<{ data: Buffer; contentType: ImageContentType }> => {
  let url: URL;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new AiProviderError(
      'malformed_response',
      'the provider returned an unreadable image URL',
    );
  }

  if (url.protocol !== 'https:' || !isAllowedHost(url.hostname)) {
    throw new AiProviderError(
      'malformed_response',
      'the provider returned an image URL from an unexpected host',
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AiProviderError(
        'upstream_error',
        `the image could not be downloaded (${response.status})`,
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? '';

    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new AiProviderError(
        'malformed_response',
        'the provider returned something that is not an image',
      );
    }

    const data = Buffer.from(await response.arrayBuffer());

    if (data.byteLength === 0 || data.byteLength > IMAGE_MAX_BYTES) {
      throw new AiProviderError('malformed_response', 'the returned image is empty or too large');
    }

    return { data, contentType: contentType as ImageContentType };
  } catch (error) {
    if (error instanceof AiProviderError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiProviderError('timeout', `the image download exceeded ${timeoutMs}ms`);
    }

    throw new AiProviderError('network', 'the generated image could not be downloaded', {
      cause: error,
    });
  } finally {
    clearTimeout(timer);
  }
};

/** Base64 is what every current model returns by default, and needs no fetch. */
const decodeBase64Image = (encoded: string): Buffer => {
  const data = Buffer.from(encoded, 'base64');

  if (data.byteLength === 0) {
    throw new AiProviderError('malformed_response', 'the provider returned an empty image');
  }

  if (data.byteLength > IMAGE_MAX_BYTES) {
    throw new AiProviderError('malformed_response', 'the returned image is too large');
  }

  return data;
};

/**
 * OpenAI's image models, behind the `ImageProvider` interface.
 *
 * Nothing above this file sees a size string, a base64 payload or a signed
 * blob URL. Swapping the model — or the vendor — is a configuration change.
 */
export class OpenAiImageProvider implements ImageProvider {
  readonly name = 'openai';
  readonly isConfigured = true;

  private readonly log: Logger;
  private readonly fetchImpl: FetchLike;

  constructor(private readonly options: OpenAiImageProviderOptions) {
    this.log = options.logger ?? createLogger('image-openai');
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  }

  get model(): string {
    return this.options.model;
  }

  /** `dall-e-3` refuses `n` above 1; the newer models take up to ten. */
  get maxImagesPerRequest(): number {
    return isDallE(this.options.model) ? 1 : 4;
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    const dallE = isDallE(this.options.model);
    const size = (dallE ? DALL_E_3_SIZES : GPT_IMAGE_SIZES)[request.aspectRatio];
    const count = Math.max(1, Math.min(request.count, this.maxImagesPerRequest));

    const body: Record<string, unknown> = {
      model: this.options.model,
      prompt: composePrompt(request),
      n: count,
      size,
    };

    if (request.quality) {
      // The two families spell the levels differently; neither accepts the
      // other's vocabulary, so the translation happens here.
      body.quality = dallE
        ? request.quality === 'high'
          ? 'hd'
          : 'standard'
        : request.quality === 'high'
          ? 'high'
          : 'medium';
    }

    if (dallE) {
      // Asking for base64 avoids the expiring URL entirely. `gpt-image-1`
      // rejects the parameter and returns base64 regardless.
      body.response_format = 'b64_json';
    }

    const response = await postJson<OpenAiImageResponse>(
      {
        url: `${this.options.baseUrl.replace(/\/$/, '')}/images/generations`,
        headers: { authorization: `Bearer ${this.options.apiKey}` },
        body,
        endpoint: '/images/generations',
      },
      {
        timeoutMs: this.options.timeoutMs,
        maxRetries: this.options.maxRetries,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
        ...(this.options.sleep ? { sleep: this.options.sleep } : {}),
        logger: this.log,
      },
    );

    const items = response.data ?? [];

    if (items.length === 0) {
      throw new AiProviderError('malformed_response', 'the provider returned no images');
    }

    const dimensions = parseSize(size);
    const images: GeneratedImage[] = [];

    for (const item of items) {
      const resolved = item.b64_json
        ? { data: decodeBase64Image(item.b64_json), contentType: 'image/png' as ImageContentType }
        : item.url
          ? await fetchImageBytes(item.url, this.fetchImpl, this.options.timeoutMs)
          : null;

      if (!resolved) {
        throw new AiProviderError(
          'malformed_response',
          'the provider returned an entry with neither image data nor a URL',
        );
      }

      images.push({
        ...resolved,
        ...dimensions,
        revisedPrompt: item.revised_prompt ?? null,
      });
    }

    return { images, model: response.model ?? this.options.model };
  }
}
