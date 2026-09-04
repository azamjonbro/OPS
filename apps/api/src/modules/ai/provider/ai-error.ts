import { ApiError } from '../../../core/http/api-error.js';

/**
 * Every way a model call can fail, in Hadiya's own vocabulary.
 *
 * The kind — not the provider's status code — is what the rest of the system
 * reacts to, so swapping OpenAI for Anthropic changes nothing above this file.
 */
export const AI_ERROR_KINDS = [
  'not_configured',
  'invalid_credentials',
  'model_unavailable',
  'rate_limited',
  'timeout',
  'network',
  'malformed_response',
  'content_filtered',
  'upstream_error',
] as const;

export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export interface AiErrorContext {
  status?: number;
  retryAfterSeconds?: number;
  /** Provider's own error code, useful in a log and safe to keep. */
  providerCode?: string;
  cause?: unknown;
}

/**
 * A model-call failure.
 *
 * The message is written for a person and never carries a credential, a header
 * or a provider stack trace: an upstream body can echo request material back,
 * so nothing from it is ever put in the message a caller sees.
 */
export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;
  readonly providerCode: string | undefined;

  constructor(kind: AiErrorKind, message: string, context: AiErrorContext = {}) {
    super(message, { cause: context.cause });
    this.name = 'AiProviderError';
    this.kind = kind;
    this.status = context.status;
    this.retryAfterSeconds = context.retryAfterSeconds;
    this.providerCode = context.providerCode;
  }

  /** True when the same request could plausibly succeed on a retry. */
  get isRetryable(): boolean {
    return (
      this.kind === 'rate_limited' ||
      this.kind === 'timeout' ||
      this.kind === 'network' ||
      this.kind === 'upstream_error'
    );
  }

  /**
   * How the failure reaches a Hadiya client.
   *
   * A bad key or an unavailable model is *our* misconfiguration, not the
   * caller's mistake, so it surfaces as a `503` rather than a `401` or a `400`
   * that would suggest they did something wrong.
   */
  toApiError(): ApiError {
    const options = { cause: this, details: { integration: 'ai', kind: this.kind } };

    if (this.kind === 'rate_limited') {
      return ApiError.rateLimited('The AI assistant is busy, please try again shortly', options);
    }

    if (this.kind === 'content_filtered') {
      return ApiError.badRequest('The assistant declined to answer that request', options);
    }

    return ApiError.dependencyUnavailable(
      `The AI assistant is unavailable: ${this.message}`,
      options,
    );
  }
}

export const isAiProviderError = (error: unknown): error is AiProviderError =>
  error instanceof AiProviderError;
