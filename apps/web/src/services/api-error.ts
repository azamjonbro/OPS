import type { ApiErrorCode } from '@hadiya/shared';

/** A failed API call, normalised so views never inspect an Axios error. */
export class ApiClientError extends Error {
  readonly code: ApiErrorCode | 'NETWORK_ERROR';
  readonly status: number | undefined;
  readonly details: unknown;
  readonly requestId: string | undefined;

  constructor(
    message: string,
    options: {
      code: ApiErrorCode | 'NETWORK_ERROR';
      status?: number;
      details?: unknown;
      requestId?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiClientError';
    this.code = options.code;
    this.status = options.status;
    this.details = options.details;
    this.requestId = options.requestId;
  }
}

export const isApiClientError = (error: unknown): error is ApiClientError =>
  error instanceof ApiClientError;

export const toErrorMessage = (error: unknown, fallback = 'Something went wrong'): string => {
  if (isApiClientError(error) || error instanceof Error) {
    return error.message;
  }

  return fallback;
};
