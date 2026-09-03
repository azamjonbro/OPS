import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ZodType, ZodError } from 'zod';

import { ApiError } from '../http/api-error.js';

export interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

type Output<TSchema> = TSchema extends ZodType<infer TOutput> ? TOutput : undefined;

export interface ValidatedPayload<TSchemas extends ValidationSchemas> {
  body: Output<TSchemas['body']>;
  query: Output<TSchemas['query']>;
  params: Output<TSchemas['params']>;
}

export interface ValidatedRequest<TSchemas extends ValidationSchemas> extends Request {
  validated: ValidatedPayload<TSchemas>;
}

export type ValidatedHandler<TSchemas extends ValidationSchemas> = (
  req: ValidatedRequest<TSchemas>,
  res: Response,
  next: NextFunction,
) => void | Promise<void>;

const toFieldIssues = (error: ZodError): Array<{ path: string; message: string }> =>
  error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

const parsePart = (schema: ZodType | undefined, value: unknown, part: string): unknown => {
  if (!schema) {
    return undefined;
  }

  const result = schema.safeParse(value);

  if (!result.success) {
    throw ApiError.validation(`Invalid request ${part}`, toFieldIssues(result.error));
  }

  return result.data;
};

/**
 * Validates and coerces the request, writing the parsed result to
 * `req.validated`. The raw `req.body` / `req.query` / `req.params` are left
 * untouched — in Express 5 `req.query` is a getter and cannot be reassigned.
 */
export const validate =
  (schemas: ValidationSchemas): RequestHandler =>
  (req, _res, next) => {
    try {
      req.validated = {
        body: parsePart(schemas.body, req.body, 'body'),
        query: parsePart(schemas.query, req.query, 'query'),
        params: parsePart(schemas.params, req.params, 'path parameters'),
      };

      next();
    } catch (error) {
      next(error);
    }
  };

/**
 * Binds schemas to a handler so the handler receives a fully typed
 * `req.validated`. This is the only place that casts the request, keeping
 * feature modules free of type assertions.
 *
 *   router.post('/', ...validated({ body: createProductSchema }, controller.create));
 */
export const validated = <TSchemas extends ValidationSchemas>(
  schemas: TSchemas,
  handler: ValidatedHandler<TSchemas>,
): RequestHandler[] => [
  validate(schemas),
  (req, res, next) => {
    void Promise.resolve(handler(req as ValidatedRequest<TSchemas>, res, next)).catch(next);
  },
];
