import type { ApiErrorCode } from '@hadiya/shared';

import { HTTP_STATUS, type HttpStatus } from './http-status.js';

export interface ApiErrorOptions {
  /** Machine-readable context returned to the client, e.g. field issues. */
  details?: unknown;
  /** The lower-level error that caused this one. Logged, never returned. */
  cause?: unknown;
}

/**
 * An error with an intended HTTP representation. Anything thrown that is *not*
 * an `ApiError` is treated as a bug and reported as a 500 without leaking its
 * message to the client.
 */
export class ApiError extends Error {
  readonly statusCode: HttpStatus;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  /** Expected failures (`true`) versus unexpected bugs (`false`). */
  readonly isOperational = true;

  constructor(
    statusCode: HttpStatus,
    code: ApiErrorCode,
    message: string,
    options: ApiErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
  }

  static badRequest(message: string, options?: ApiErrorOptions): ApiError {
    return new ApiError(HTTP_STATUS.BAD_REQUEST, 'VALIDATION_ERROR', message, options);
  }

  static validation(message: string, details: unknown): ApiError {
    return new ApiError(HTTP_STATUS.UNPROCESSABLE_ENTITY, 'VALIDATION_ERROR', message, {
      details,
    });
  }

  static unauthenticated(message = 'Authentication is required', options?: ApiErrorOptions) {
    return new ApiError(HTTP_STATUS.UNAUTHORIZED, 'UNAUTHENTICATED', message, options);
  }

  static forbidden(message = 'You do not have access to this resource', options?: ApiErrorOptions) {
    return new ApiError(HTTP_STATUS.FORBIDDEN, 'UNAUTHORIZED', message, options);
  }

  static notFound(message = 'Resource not found', options?: ApiErrorOptions): ApiError {
    return new ApiError(HTTP_STATUS.NOT_FOUND, 'NOT_FOUND', message, options);
  }

  static conflict(message: string, options?: ApiErrorOptions): ApiError {
    return new ApiError(HTTP_STATUS.CONFLICT, 'CONFLICT', message, options);
  }

  static rateLimited(message = 'Too many requests', options?: ApiErrorOptions): ApiError {
    return new ApiError(HTTP_STATUS.TOO_MANY_REQUESTS, 'RATE_LIMITED', message, options);
  }

  static dependencyUnavailable(message: string, options?: ApiErrorOptions): ApiError {
    return new ApiError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      'DEPENDENCY_UNAVAILABLE',
      message,
      options,
    );
  }

  static internal(message = 'Internal server error', options?: ApiErrorOptions): ApiError {
    return new ApiError(HTTP_STATUS.INTERNAL_SERVER_ERROR, 'INTERNAL_ERROR', message, options);
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;
