import { IMAGE_MAX_BYTES } from '@hadiya/shared';
import { describe, expect, it } from 'vitest';

import { AiProviderError } from '../../ai/provider/ai-error.js';
import type { FetchLike } from '../../ai/provider/ai-http.js';
import { PNG_PIXEL } from '../test-support.js';
import { OpenAiImageProvider } from './openai-image.provider.js';

/**
 * The real provider class, driven by scripted HTTP.
 *
 * This exercises the whole path production runs — request shape, wire format,
 * base64 decoding, URL validation — with the network as the only thing
 * replaced, so nothing about the flow is faked and no paid call is made.
 */

interface ScriptedResponse {
  status?: number;
  body?: unknown;
  /** For the image download leg, which returns bytes rather than JSON. */
  bytes?: Buffer;
  contentType?: string;
  headers?: Record<string, string>;
}

const createFetch = (
  script: ScriptedResponse[],
): { fetchImpl: FetchLike; calls: Array<{ url: string; body: unknown; method: string }> } => {
  const calls: Array<{ url: string; body: unknown; method: string }> = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: typeof init.body === 'string' ? JSON.parse(init.body) : null,
    });

    const scripted = script[index] ?? script.at(-1) ?? {};
    index += 1;

    const headers = new Headers({
      'content-type': scripted.contentType ?? 'application/json',
      ...scripted.headers,
    });

    if (scripted.bytes) {
      return new Response(new Uint8Array(scripted.bytes), {
        status: scripted.status ?? 200,
        headers,
      });
    }

    return new Response(JSON.stringify(scripted.body ?? {}), {
      status: scripted.status ?? 200,
      headers,
    });
  };

  return { fetchImpl, calls };
};

const buildProvider = (script: ScriptedResponse[], model = 'gpt-image-1') => {
  const { fetchImpl, calls } = createFetch(script);

  return {
    calls,
    provider: new OpenAiImageProvider({
      apiKey: 'sk-test-key',
      model,
      baseUrl: 'https://images.test/v1',
      timeoutMs: 2_000,
      maxRetries: 0,
      fetchImpl,
      sleep: async () => undefined,
    }),
  };
};

const base64Response = (count = 1) => ({
  body: {
    model: 'gpt-image-1',
    data: Array.from({ length: count }, (_, index) => ({
      b64_json: PNG_PIXEL.toString('base64'),
      revised_prompt: `revised ${index + 1}`,
    })),
  },
});

describe('a successful generation', () => {
  it('returns decoded bytes, not a link', async () => {
    const { provider } = buildProvider([base64Response()]);

    const result = await provider.generate({ prompt: 'a watch', count: 1, aspectRatio: '1:1' });

    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.data.equals(PNG_PIXEL)).toBe(true);
    expect(result.images[0]).toMatchObject({
      contentType: 'image/png',
      width: 1024,
      height: 1024,
      revisedPrompt: 'revised 1',
    });
    expect(result.model).toBe('gpt-image-1');
  });

  it('sends the credential in the header and never in the body', async () => {
    const { provider, calls } = buildProvider([base64Response()]);

    await provider.generate({ prompt: 'a watch', count: 1, aspectRatio: '1:1' });

    // The key must never end up somewhere it could be logged as request content.
    expect(JSON.stringify(calls[0]?.body)).not.toContain('sk-test-key');
    expect(calls[0]?.url).toBe('https://images.test/v1/images/generations');
    expect(calls[0]?.url).not.toContain('sk-test-key');
  });

  it('maps an aspect ratio to the size the model accepts', async () => {
    const { provider, calls } = buildProvider([base64Response(), base64Response()]);

    await provider.generate({ prompt: 'a', count: 1, aspectRatio: '16:9' });
    await provider.generate({ prompt: 'a', count: 1, aspectRatio: '9:16' });

    expect(calls[0]?.body).toMatchObject({ size: '1536x1024' });
    expect(calls[1]?.body).toMatchObject({ size: '1024x1536' });
  });

  it('uses the other size vocabulary for dall-e-3, and asks for base64', async () => {
    const { provider, calls } = buildProvider([base64Response()], 'dall-e-3');

    await provider.generate({ prompt: 'a', count: 1, aspectRatio: '16:9', quality: 'high' });

    expect(calls[0]?.body).toMatchObject({
      size: '1792x1024',
      response_format: 'b64_json',
      // The two families spell the quality levels differently.
      quality: 'hd',
      n: 1,
    });
  });

  it('appends the house style to the prompt rather than inventing a parameter', async () => {
    const { provider, calls } = buildProvider([base64Response()]);

    await provider.generate({ prompt: 'a watch', count: 1, aspectRatio: '1:1', style: 'studio' });

    const body = calls[0]?.body as { prompt: string };
    expect(body.prompt).toContain('a watch');
    expect(body.prompt).toContain('studio product shot');
  });

  it('produces several images in one call where the model allows it', async () => {
    const { provider, calls } = buildProvider([base64Response(3)]);

    const result = await provider.generate({ prompt: 'a', count: 3, aspectRatio: '1:1' });

    expect(result.images).toHaveLength(3);
    expect(calls[0]?.body).toMatchObject({ n: 3 });
  });

  it('clamps to one for a model that refuses more', async () => {
    const { provider, calls } = buildProvider([base64Response()], 'dall-e-3');

    expect(provider.maxImagesPerRequest).toBe(1);
    await provider.generate({ prompt: 'a', count: 4, aspectRatio: '1:1' });
    expect(calls[0]?.body).toMatchObject({ n: 1 });
  });
});

describe('images returned as a link', () => {
  it('downloads them, so nothing depends on a URL that expires', async () => {
    const { provider, calls } = buildProvider([
      {
        body: {
          model: 'dall-e-3',
          data: [{ url: 'https://oaidalleapiprodscus.blob.core.windows.net/x/y.png' }],
        },
      },
      { bytes: PNG_PIXEL, contentType: 'image/png' },
    ]);

    const result = await provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' });

    expect(result.images[0]?.data.equals(PNG_PIXEL)).toBe(true);
    expect(calls[1]?.method).toBe('GET');
  });

  it('refuses a link to a host that is not the provider’s', async () => {
    const { provider } = buildProvider([
      { body: { data: [{ url: 'https://evil.example.com/payload.png' }] } },
    ]);

    // An upstream response is not trusted input just because it was
    // authenticated.
    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /unexpected host/,
    );
  });

  it('refuses a plain-http link', async () => {
    const { provider } = buildProvider([
      { body: { data: [{ url: 'http://oaidalleapiprodscus.blob.core.windows.net/x.png' }] } },
    ]);

    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /unexpected host/,
    );
  });

  it('refuses a download that is not an image', async () => {
    const { provider } = buildProvider([
      { body: { data: [{ url: 'https://oaidalleapiprodscus.blob.core.windows.net/x.png' }] } },
      { bytes: Buffer.from('<html>'), contentType: 'text/html' },
    ]);

    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /not an image/,
    );
  });
});

describe('malformed and failing responses', () => {
  it('refuses a response with no images', async () => {
    const { provider } = buildProvider([{ body: { data: [] } }]);

    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /returned no images/,
    );
  });

  it('refuses an entry with neither data nor a URL', async () => {
    const { provider } = buildProvider([{ body: { data: [{ revised_prompt: 'x' }] } }]);

    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /neither image data nor a URL/,
    );
  });

  it('refuses an empty image', async () => {
    const { provider } = buildProvider([{ body: { data: [{ b64_json: '' }] } }]);

    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /neither image data nor a URL/,
    );
  });

  it('refuses an image beyond the size cap', async () => {
    const oversized = Buffer.alloc(IMAGE_MAX_BYTES + 1).toString('base64');
    const { provider } = buildProvider([{ body: { data: [{ b64_json: oversized }] } }]);

    await expect(provider.generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })).rejects.toThrow(
      /too large/,
    );
  });

  it('turns a rejected key into a credential error, without echoing the body', async () => {
    const { provider } = buildProvider([
      {
        status: 401,
        body: { error: { message: 'Incorrect API key sk-test-key', code: 'bad_key' } },
      },
    ]);

    const error = await provider
      .generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AiProviderError);
    expect((error as AiProviderError).kind).toBe('invalid_credentials');
    // A provider can echo the request — including the key — back inside an
    // error body, so none of it reaches the message a caller sees.
    expect((error as Error).message).not.toContain('sk-test-key');
  });

  it('reports a rate limit as itself, so the caller can back off', async () => {
    const { provider } = buildProvider([{ status: 429, body: { error: { code: 'rate_limit' } } }]);

    const error = await provider
      .generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })
      .catch((caught: unknown) => caught);

    expect((error as AiProviderError).kind).toBe('rate_limited');
  });

  it('reports a timeout as a timeout', async () => {
    const provider = new OpenAiImageProvider({
      apiKey: 'sk-test-key',
      model: 'gpt-image-1',
      baseUrl: 'https://images.test/v1',
      timeoutMs: 20,
      maxRetries: 0,
      sleep: async () => undefined,
      fetchImpl: (_url, init) =>
        new Promise((_resolve, reject) => {
          // Never answers; the provider's own abort signal ends it.
          init.signal?.addEventListener('abort', () => {
            const abort = new Error('aborted');
            abort.name = 'AbortError';
            reject(abort);
          });
        }),
    });

    const error = await provider
      .generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })
      .catch((caught: unknown) => caught);

    expect((error as AiProviderError).kind).toBe('timeout');
  });

  it('reports a body that is not JSON', async () => {
    const { provider } = buildProvider([
      { bytes: Buffer.from('not json'), contentType: 'text/plain' },
    ]);

    const error = await provider
      .generate({ prompt: 'a', count: 1, aspectRatio: '1:1' })
      .catch((caught: unknown) => caught);

    expect((error as AiProviderError).kind).toBe('malformed_response');
  });
});
