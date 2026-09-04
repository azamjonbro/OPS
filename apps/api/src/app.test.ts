import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { createApp } from './app.js';
import { config } from './config/index.js';
import { HTTP_STATUS } from './core/http/http-status.js';

const app = createApp();
const healthUrl = `${config.http.basePath}/health`;

describe(`GET ${config.http.basePath}/health`, () => {
  it('returns the health payload in the standard envelope', async () => {
    const response = await request(app).get(healthUrl);

    expect(response.body).toMatchObject({
      success: true,
      data: {
        service: config.app.name,
        version: config.app.version,
        environment: 'test',
        dependencies: [expect.objectContaining({ name: 'mongodb', required: true })],
      },
      meta: { requestId: expect.any(String), timestamp: expect.any(String) },
    });
  });

  it('maps the reported status to the HTTP status code', async () => {
    const response = await request(app).get(healthUrl);
    const expected =
      response.body.data.status === 'down' ? HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.OK;

    expect(response.status).toBe(expected);
  });

  it('echoes the correlation id back to the caller', async () => {
    const response = await request(app).get(healthUrl).set('x-request-id', 'trace-123');

    expect(response.headers['x-request-id']).toBe('trace-123');
    expect(response.body.meta.requestId).toBe('trace-123');
  });

  it('answers liveness without touching a dependency', async () => {
    const response = await request(app).get(`${healthUrl}/live`);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ status: 'ok', uptimeSeconds: expect.any(Number) });
  });
});

describe('unmatched routes', () => {
  it('returns a 404 in the error envelope', async () => {
    const response = await request(app).get(`${config.http.basePath}/does-not-exist`);

    expect(response.status).toBe(HTTP_STATUS.NOT_FOUND);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'NOT_FOUND' },
    });
  });

  it('answers an unknown business route with 401, not 404, when anonymous', async () => {
    // The guard runs before route matching, so an anonymous caller cannot use
    // 404s to map which endpoints exist.
    const response = await request(app).get(`${config.http.basePath}/v1/does-not-exist`);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});
