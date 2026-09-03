import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { errorHandler } from './error-handler.js';
import { requestContext } from './request-context.js';
import { validated } from './validate.js';
import { sendSuccess } from '../http/api-response.js';
import { HTTP_STATUS } from '../http/http-status.js';

const bodySchema = z.object({ name: z.string().min(1), quantity: z.coerce.number().int().min(1) });
const querySchema = z.object({ branchId: z.string().optional() });

const buildTestApp = (): express.Express => {
  const app = express();

  app.use(requestContext());
  app.use(express.json());
  app.post(
    '/items',
    ...validated({ body: bodySchema, query: querySchema }, (req, res) => {
      sendSuccess(req, res, {
        name: req.validated.body.name,
        quantity: req.validated.body.quantity,
      });
    }),
  );
  app.use(errorHandler());

  return app;
};

describe('validate middleware', () => {
  it('exposes coerced, typed input on req.validated', async () => {
    const response = await request(buildTestApp())
      .post('/items?branchId=main')
      .send({ name: 'Coffee', quantity: '3' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toEqual({ name: 'Coffee', quantity: 3 });
  });

  it('rejects an invalid body with a 422 and field-level issues', async () => {
    const response = await request(buildTestApp()).post('/items').send({ name: '', quantity: 0 });

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'name' })]),
    );
  });
});
