import { ApiError } from '../../../core/http/api-error.js';
import { HTTP_STATUS } from '../../../core/http/http-status.js';

/**
 * Every way a Billz call can fail, expressed in Hadiya's own vocabulary so no
 * caller has to interpret an HTTP status or a driver exception.
 */
export const BILLZ_ERROR_KINDS = [
  'not_configured',
  'unauthorized',
  'forbidden',
  'not_found',
  'rate_limited',
  'timeout',
  'network',
  'malformed_response',
  'upstream_error',
] as const;

export type BillzErrorKind = (typeof BILLZ_ERROR_KINDS)[number];

export interface BillzErrorContext {
  /** Endpoint path only — never the full URL, which may carry query values. */
  endpoint?: string;
  status?: number;
  /** Seconds the upstream asked us to wait, when it said so. */
  retryAfterSeconds?: number;
  cause?: unknown;
}

/**
 * A failure from the Billz integration. It carries the upstream detail for
 * logging and maps itself to the response the rest of Hadiya should return, so
 * controllers never translate Billz semantics by hand.
 */
export class BillzError extends Error {
  readonly kind: BillzErrorKind;
  readonly endpoint: string | undefined;
  readonly status: number | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(kind: BillzErrorKind, message: string, context: BillzErrorContext = {}) {
    super(message, { cause: context.cause });
    this.name = 'BillzError';
    this.kind = kind;
    this.endpoint = context.endpoint;
    this.status = context.status;
    this.retryAfterSeconds = context.retryAfterSeconds;
  }

  /** True when trying the same call again could plausibly succeed. */
  get isRetryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'timeout' || this.kind === 'network';
  }

  /**
   * How this failure surfaces to a Hadiya client. Billz being unreachable or
   * misconfigured is a `503` on our side — it is our dependency that failed,
   * not the caller's request.
   */
  toApiError(): ApiError {
    const options = { cause: this, details: { integration: 'billz', kind: this.kind } };

    switch (this.kind) {
      case 'not_configured':
        return ApiError.dependencyUnavailable('The Billz integration is not configured', options);
      case 'not_found':
        return new ApiError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', this.message, options);
      case 'rate_limited':
        return ApiError.rateLimited('Billz is rate limiting this integration', options);
      case 'unauthorized':
      case 'forbidden':
        // The Billz credential is ours, not the caller's: a permission problem
        // upstream is an integration outage here, never a 401 to our user.
        return ApiError.dependencyUnavailable(
          'The Billz credential was rejected for this request',
          options,
        );
      default:
        return ApiError.dependencyUnavailable('Billz is currently unavailable', options);
    }
  }
}

export const isBillzError = (error: unknown): error is BillzError => error instanceof BillzError;
