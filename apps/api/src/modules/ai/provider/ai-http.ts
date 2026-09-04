import type { Logger } from 'pino';

import { AiProviderError } from './ai-error.js';

/** Injected in tests; production uses the platform `fetch`. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface AiHttpOptions {
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Injected so retry backoff does not make tests slow. */
  sleep?: (ms: number) => Promise<void>;
}

export interface AiHttpRequest {
  url: string;
  headers: Record<string, string>;
  body: unknown;
  /** Used only in logs and error text, never the full URL with its query. */
  endpoint: string;
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 8_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_UNPROCESSABLE = 422;
/** Enough of an error body to diagnose from; short enough not to be a payload. */
const LOGGED_BODY_LIMIT = 300;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

interface ProviderErrorBody {
  error?: { message?: string; type?: string; code?: string };
  message?: string;
  type?: string;
}

/** The provider's own error code, which is safe to keep; the message is not. */
const readProviderCode = (body: string): string | undefined => {
  try {
    const parsed = JSON.parse(body) as ProviderErrorBody;

    return parsed.error?.code ?? parsed.error?.type ?? parsed.type;
  } catch {
    return undefined;
  }
};

const classify = (status: number, providerCode: string | undefined): AiProviderError => {
  const context = { status, ...(providerCode ? { providerCode } : {}) };

  if (status === HTTP_UNAUTHORIZED || status === HTTP_FORBIDDEN) {
    return new AiProviderError(
      'invalid_credentials',
      'the configured API key was rejected',
      context,
    );
  }

  if (status === HTTP_NOT_FOUND || providerCode === 'model_not_found') {
    return new AiProviderError(
      'model_unavailable',
      'the configured model is not available',
      context,
    );
  }

  if (status === HTTP_TOO_MANY_REQUESTS) {
    return new AiProviderError('rate_limited', 'the provider is rate limiting this key', context);
  }

  if (status === HTTP_UNPROCESSABLE) {
    return new AiProviderError('upstream_error', 'the provider rejected the request', context);
  }

  return new AiProviderError('upstream_error', `the provider answered ${status}`, context);
};

/**
 * One JSON call to a model API, with the behaviour both providers need:
 * a timeout, bounded retries with backoff, and failures turned into
 * `AiProviderError`.
 *
 * The credential lives only in the headers passed in and is never logged; error
 * bodies are logged truncated and never reach the caller's message, because a
 * provider can echo request content — including the prompt — back inside one.
 */
export const postJson = async <TResponse>(
  request: AiHttpRequest,
  options: AiHttpOptions,
): Promise<TResponse> => {
  const fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
  const sleep = options.sleep ?? defaultSleep;
  let lastError: AiProviderError | null = null;

  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    if (attempt > 0) {
      const backoff =
        lastError?.retryAfterSeconds !== undefined
          ? Math.min(lastError.retryAfterSeconds * 1_000, MAX_BACKOFF_MS)
          : Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);

      await sleep(backoff);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const startedAt = Date.now();

    try {
      const response = await fetchImpl(request.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...request.headers },
        body: JSON.stringify(request.body),
        signal: controller.signal,
      });

      const text = await response.text();

      options.logger?.debug(
        { endpoint: request.endpoint, status: response.status, durationMs: Date.now() - startedAt },
        'ai provider request completed',
      );

      if (!response.ok) {
        const providerCode = readProviderCode(text);
        const error = classify(response.status, providerCode);
        const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

        options.logger?.warn(
          {
            endpoint: request.endpoint,
            status: response.status,
            providerCode,
            body: text.slice(0, LOGGED_BODY_LIMIT),
          },
          'ai provider request failed',
        );

        const enriched =
          retryAfter === undefined
            ? error
            : new AiProviderError(error.kind, error.message, {
                status: response.status,
                retryAfterSeconds: retryAfter,
                ...(providerCode ? { providerCode } : {}),
              });

        if (!RETRYABLE_STATUSES.has(response.status) || attempt === options.maxRetries) {
          throw enriched;
        }

        lastError = enriched;
        continue;
      }

      try {
        return JSON.parse(text) as TResponse;
      } catch (error) {
        throw new AiProviderError(
          'malformed_response',
          'the provider returned a response that is not JSON',
          { status: response.status, cause: error },
        );
      }
    } catch (error) {
      if (error instanceof AiProviderError) {
        if (!error.isRetryable || attempt === options.maxRetries) {
          throw error;
        }

        lastError = error;
        continue;
      }

      const wrapped =
        error instanceof Error && error.name === 'AbortError'
          ? new AiProviderError(
              'timeout',
              `the provider did not respond within ${options.timeoutMs}ms`,
              {
                cause: error,
              },
            )
          : new AiProviderError('network', 'the provider could not be reached', { cause: error });

      if (attempt === options.maxRetries) {
        throw wrapped;
      }

      lastError = wrapped;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new AiProviderError('upstream_error', 'the provider request failed');
};
