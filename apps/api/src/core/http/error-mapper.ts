import type { ApiErrorBody } from '@hadiya/shared';
import mongoose from 'mongoose';
import { ZodError } from 'zod';

import { ApiError, isApiError } from './api-error.js';
import { HTTP_STATUS, type HttpStatus } from './http-status.js';

export interface MappedError {
  statusCode: HttpStatus;
  body: ApiErrorBody;
  /** False when the error is an unexpected bug and must be logged at error level. */
  isOperational: boolean;
}

const MONGO_DUPLICATE_KEY_CODE = 11_000;

interface ZodFieldIssue {
  path: string;
  message: string;
}

const toFieldIssues = (error: ZodError): ZodFieldIssue[] =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

const isMongoDuplicateKeyError = (error: unknown): boolean =>
  error instanceof mongoose.mongo.MongoServerError && error.code === MONGO_DUPLICATE_KEY_CODE;

/**
 * Translates anything thrown inside the app into a client-safe HTTP shape.
 * Kept free of Express so it can be unit tested directly.
 */
export const mapError = (error: unknown): MappedError => {
  if (isApiError(error)) {
    return {
      statusCode: error.statusCode,
      body: { code: error.code, message: error.message, details: error.details },
      isOperational: error.isOperational,
    };
  }

  if (error instanceof ZodError) {
    return {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      body: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: toFieldIssues(error),
      },
      isOperational: true,
    };
  }

  if (error instanceof mongoose.Error.ValidationError) {
    return {
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      body: {
        code: 'VALIDATION_ERROR',
        message: 'Document validation failed',
        details: Object.entries(error.errors).map(([path, issue]) => ({
          path,
          message: issue.message,
        })),
      },
      isOperational: true,
    };
  }

  if (error instanceof mongoose.Error.CastError) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      body: {
        code: 'VALIDATION_ERROR',
        message: `Invalid value for "${error.path}"`,
        details: { path: error.path },
      },
      isOperational: true,
    };
  }

  if (isMongoDuplicateKeyError(error)) {
    return {
      statusCode: HTTP_STATUS.CONFLICT,
      body: { code: 'CONFLICT', message: 'A record with these values already exists' },
      isOperational: true,
    };
  }

  // A body-parser failure is a client problem, not a server bug.
  if (error instanceof SyntaxError && 'body' in error) {
    return {
      statusCode: HTTP_STATUS.BAD_REQUEST,
      body: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' },
      isOperational: true,
    };
  }

  const fallback = ApiError.internal();

  return {
    statusCode: fallback.statusCode,
    body: { code: fallback.code, message: fallback.message },
    isOperational: false,
  };
};
