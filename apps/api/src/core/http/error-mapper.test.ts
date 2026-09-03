import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApiError } from './api-error.js';
import { mapError } from './error-mapper.js';
import { HTTP_STATUS } from './http-status.js';

describe('mapError', () => {
  it('preserves the status, code and details of an ApiError', () => {
    const error = ApiError.conflict('Barcode already exists', { details: { field: 'barcode' } });

    expect(mapError(error)).toEqual({
      statusCode: HTTP_STATUS.CONFLICT,
      body: {
        code: 'CONFLICT',
        message: 'Barcode already exists',
        details: { field: 'barcode' },
      },
      isOperational: true,
    });
  });

  it('turns a Zod failure into a 422 with per-field issues', () => {
    const result = z.object({ price: z.number() }).safeParse({ price: 'free' });
    const mapped = mapError(result.success ? new Error('unreachable') : result.error);

    expect(mapped.statusCode).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(mapped.body.code).toBe('VALIDATION_ERROR');
    expect(mapped.body.details).toEqual([expect.objectContaining({ path: 'price' })]);
  });

  it('reports malformed JSON as a client error', () => {
    const syntaxError = Object.assign(new SyntaxError('Unexpected token }'), { body: '{,}' });

    expect(mapError(syntaxError)).toMatchObject({
      statusCode: HTTP_STATUS.BAD_REQUEST,
      isOperational: true,
    });
  });

  it('hides the message of an unexpected error behind a generic 500', () => {
    const mapped = mapError(new Error('connection string leaked here'));

    expect(mapped).toEqual({
      statusCode: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      body: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
      isOperational: false,
    });
  });
});
