import type { Logger } from 'pino';

import { config } from '../../../config/index.js';
import { createLogger } from '../../../core/logger/logger.js';
import { BillzTokenProvider } from './billz-auth.js';
import { BILLZ_ENDPOINTS } from './billz-endpoints.js';
import { BillzError } from './billz-error.js';

/** Injected in tests; production uses the platform `fetch`. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface BillzHttpClientOptions {
  baseUrl: string;
  secretToken: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: FetchLike;
  logger?: Logger;
  /** Injected so retry backoff does not make tests slow. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface BillzRequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  method?: 'GET' | 'POST' | 'PUT';
  /** Set for the login call itself, which cannot carry a bearer token. */
  skipAuth?: boolean;
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const BASE_BACKOFF_MS = 300;
const MAX_BACKOFF_MS = 5_000;
const HTTP_UNAUTHORIZED = 401;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_TOO_MANY_REQUESTS = 429;

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const buildUrl = (baseUrl: string, path: string, query: BillzRequestOptions['query']): string => {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  return url.toString();
};

const parseRetryAfter = (header: string | null): number | undefined => {
  if (!header) {
    return undefined;
  }

  const seconds = Number(header);

  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
};

/**
 * The single place Hadiya talks HTTP to Billz.
 *
 * It owns authentication, timeouts, retries, rate-limit backoff and turning
 * every failure into a `BillzError`. Services above it deal in resources, never
 * in status codes, headers or JSON parsing.
 *
 * Logging deliberately records the endpoint path, status and duration only:
 * query strings can carry customer phone numbers, and bodies carry the secret
 * token, so neither is ever written to a log.
 */
export class BillzHttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly log: Logger;
  private readonly tokens: BillzTokenProvider;

  constructor(private readonly options: BillzHttpClientOptions) {
    this.fetchImpl = options.fetchImpl ?? ((url, init) => fetch(url, init));
    this.sleep = options.sleep ?? defaultSleep;
    this.log = options.logger ?? createLogger('billz');
    this.tokens = new BillzTokenProvider(
      options.secretToken,
      (path, body) => this.send(path, { method: 'POST', body, skipAuth: true }),
      this.log,
      options.now,
    );
  }

  /**
   * Performs a request, authenticating first and retrying where it is safe to.
   *
   * A `401` is retried exactly once with a fresh token: a token can expire
   * between being checked and being used, and that should not surface as an
   * outage.
   */
  async request<TResponse>(path: string, options: BillzRequestOptions = {}): Promise<TResponse> {
    try {
      return (await this.send(path, options)) as TResponse;
    } catch (error) {
      if (error instanceof BillzError && error.kind === 'unauthorized' && !options.skipAuth) {
        this.log.warn({ endpoint: path }, 'billz rejected the token; re-authenticating once');
        this.tokens.invalidate();

        return (await this.send(path, options)) as TResponse;
      }

      throw error;
    }
  }

  get isConfigured(): boolean {
    return this.options.secretToken.length > 0;
  }

  private async send(path: string, options: BillzRequestOptions): Promise<unknown> {
    const method = options.method ?? 'GET';
    const url = buildUrl(this.options.baseUrl, path, options.query);
    const headers: Record<string, string> = { accept: 'application/json' };

    if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    if (!options.skipAuth) {
      headers.Authorization = `Bearer ${await this.tokens.getToken()}`;
    }

    let lastError: BillzError | null = null;

    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(this.backoffFor(attempt, lastError));
      }

      const startedAt = Date.now();

      try {
        const response = await this.fetchWithTimeout(url, {
          method,
          headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
        });

        this.log.debug(
          { endpoint: path, status: response.status, durationMs: Date.now() - startedAt, attempt },
          'billz request completed',
        );

        if (response.ok) {
          return await this.readJson(response, path);
        }

        const error = await this.toHttpError(response, path);

        if (!RETRYABLE_STATUSES.has(response.status) || attempt === this.options.maxRetries) {
          throw error;
        }

        lastError = error;
      } catch (error) {
        if (!(error instanceof BillzError)) {
          throw error;
        }

        if (!error.isRetryable || attempt === this.options.maxRetries) {
          throw error;
        }

        lastError = error;
      }
    }

    throw lastError ?? new BillzError('upstream_error', 'Billz request failed', { endpoint: path });
  }

  /** Exponential backoff, unless Billz told us exactly how long to wait. */
  private backoffFor(attempt: number, lastError: BillzError | null): number {
    if (lastError?.retryAfterSeconds !== undefined) {
      return Math.min(lastError.retryAfterSeconds * 1_000, MAX_BACKOFF_MS);
    }

    return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);

    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new BillzError(
          'timeout',
          `Billz did not respond within ${this.options.timeoutMs}ms`,
          {
            cause: error,
          },
        );
      }

      throw new BillzError('network', 'Could not reach Billz', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }

  private async readJson(response: Response, endpoint: string): Promise<unknown> {
    const text = await response.text();

    if (text.trim().length === 0) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new BillzError('malformed_response', 'Billz returned a response that is not JSON', {
        endpoint,
        status: response.status,
        cause: error,
      });
    }
  }

  /** Maps an HTTP failure onto a kind, without letting the body into the message. */
  private async toHttpError(response: Response, endpoint: string): Promise<BillzError> {
    // Read and discard: some Billz errors only make sense in a log, and none of
    // them should reach a Hadiya client verbatim.
    const body = await response.text().catch(() => '');

    this.log.warn(
      { endpoint, status: response.status, body: body.slice(0, 200) },
      'billz request failed',
    );

    const context = { endpoint, status: response.status };

    switch (response.status) {
      case HTTP_UNAUTHORIZED:
        return new BillzError('unauthorized', 'Billz rejected the credential', context);
      case HTTP_FORBIDDEN:
        return new BillzError(
          'forbidden',
          `The Billz API key is not allowed to call ${endpoint}`,
          context,
        );
      case HTTP_NOT_FOUND:
        return new BillzError('not_found', 'The Billz record does not exist', context);
      case HTTP_TOO_MANY_REQUESTS:
        return new BillzError('rate_limited', 'Billz is rate limiting this integration', {
          ...context,
          ...(parseRetryAfter(response.headers.get('retry-after')) === undefined
            ? {}
            : { retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')) }),
        });
      default:
        return new BillzError(
          'upstream_error',
          `Billz answered ${response.status} for ${endpoint}`,
          context,
        );
    }
  }
}

let cachedClient: BillzHttpClient | null = null;

/**
 * The process-wide client. Built lazily so a deployment without Billz
 * configured never constructs one, and so tests can build their own.
 */
export const getBillzHttpClient = (): BillzHttpClient => {
  if (!config.integrations.billz.configured || !config.integrations.billz.apiToken) {
    throw new BillzError('not_configured', 'BILLZ_API_TOKEN is not set', {
      endpoint: BILLZ_ENDPOINTS.login,
    });
  }

  cachedClient ??= new BillzHttpClient({
    baseUrl: config.integrations.billz.baseUrl,
    secretToken: config.integrations.billz.apiToken,
    timeoutMs: config.integrations.billz.timeoutMs,
    maxRetries: config.integrations.billz.maxRetries,
  });

  return cachedClient;
};

/** Testing seam: forces the next `getBillzHttpClient()` to rebuild. */
export const resetBillzHttpClient = (): void => {
  cachedClient = null;
};
