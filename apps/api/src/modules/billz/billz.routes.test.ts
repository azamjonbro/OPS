import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, signInAs } from '../../test/factories.js';
import { BillzHttpClient } from './client/billz-http-client.js';
import { createBillzFetchDouble, type ScriptedResponse } from './client/billz-test-double.js';
import { createBillzServices, resetBillzServices } from './services/index.js';

const app = createApp();
const base = '/api/v1/integrations/billz';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);
afterEach(resetBillzServices);

/**
 * Replaces the process-wide Billz services with ones backed by a scripted
 * `fetch`, so an HTTP test never reaches the real Billz API.
 */
const stubBillz = async (script: ScriptedResponse[]): Promise<void> => {
  const double = createBillzFetchDouble(script);
  const client = new BillzHttpClient({
    baseUrl: 'https://api-admin.billz.test',
    secretToken: 'test-billz-secret-token',
    timeoutMs: 2_000,
    maxRetries: 0,
    fetchImpl: double.fetchImpl,
    sleep: async () => undefined,
  });
  const services = createBillzServices(client);
  const registry = await import('./services/index.js');

  // The module caches its services; swapping the cached instance is the seam.
  Object.assign(registry.getBillzServices(), services);
};

describe(`GET ${base}/products`, () => {
  it('is refused without a token', async () => {
    const response = await request(app).get(`${base}/products`);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('is refused for a cashier, who has no business reading company figures', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'cashier', String(branch._id));

    const response = await request(app).get(`${base}/products`).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('returns normalised products, never Billz field names', async () => {
    await stubBillz([
      {
        body: {
          count: 1,
          products: [
            {
              id: 'billz-product-1',
              name: 'Cola 1L',
              sku: 'COLA-1L',
              shop_prices: [{ shop_id: 's1', shop_name: 'Store', retail_price: 12_000 }],
              shop_measurement_values: [
                { shop_id: 's1', shop_name: 'Store', active_measurement_value: 4 },
              ],
            },
          ],
        },
      },
    ]);
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'manager', String(branch._id));

    const response = await request(app).get(`${base}/products`).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items[0]).toMatchObject({
      externalId: 'billz-product-1',
      name: 'Cola 1L',
      retailPrice: 1_200_000,
      totalStock: 4,
    });
    // The raw Billz vocabulary must not reach a client of this API.
    expect(response.body.data.items[0].shop_prices).toBeUndefined();
    expect(response.body.data.items[0].id).toBeUndefined();
  });

  it('reports an upstream failure as a dependency outage, not as the caller’s fault', async () => {
    await stubBillz([{ status: 403 }]);
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'manager', String(branch._id));

    const response = await request(app).get(`${base}/products`).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.SERVICE_UNAVAILABLE);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'DEPENDENCY_UNAVAILABLE', details: { integration: 'billz' } },
    });
  });
});

describe(`GET ${base}/sales`, () => {
  it('requires a date window rather than walking the whole history', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'manager', String(branch._id));

    const response = await request(app).get(`${base}/sales`).set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('rejects a window that runs backwards', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'manager', String(branch._id));

    const response = await request(app)
      .get(`${base}/sales`)
      .query({ from: '2026-09-10', to: '2026-09-01' })
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });
});

describe(`${base}/sync`, () => {
  it('is refused for a manager and accepted for an admin', async () => {
    const branch = await createTestBranch();
    const manager = await signInAs(app, 'manager', String(branch._id));
    const admin = await signInAs(app, 'admin', null);

    await stubBillz([{ body: { count: 0, shops: [] } }]);

    expect(
      (await request(app).post(`${base}/sync`).set('Authorization', manager.authorization).send({}))
        .status,
    ).toBe(HTTP_STATUS.FORBIDDEN);

    const accepted = await request(app)
      .post(`${base}/sync`)
      .set('Authorization', admin.authorization)
      .send({ mode: 'full', resource: 'branches' });

    expect(accepted.status).toBe(HTTP_STATUS.ACCEPTED);
    expect(accepted.body.data).toMatchObject({ accepted: true, resources: ['branches'] });
  });

  it('exposes sync state and logs', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'manager', String(branch._id));

    const state = await request(app).get(`${base}/sync/state`).set('Authorization', authorization);
    const logs = await request(app).get(`${base}/sync/logs`).set('Authorization', authorization);

    expect(state.status).toBe(HTTP_STATUS.OK);
    expect(logs.status).toBe(HTTP_STATUS.OK);
    // A trigger from another test may still be finishing in the background, so
    // this asserts the shape rather than an empty list.
    expect(Array.isArray(state.body.data.items)).toBe(true);
    expect(Array.isArray(logs.body.data.items)).toBe(true);

    for (const entry of state.body.data.items) {
      expect(entry).toMatchObject({
        source: 'billz',
        resource: expect.any(String),
        consecutiveFailures: expect.any(Number),
      });
    }
  });
});

describe(`GET ${base}/capabilities`, () => {
  it('lists the read-only functions the AI phase will be given', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'manager', String(branch._id));

    const response = await request(app)
      .get(`${base}/capabilities`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    const names = response.body.data.items.map((item: { name: string }) => item.name);
    expect(names).toContain('searchProducts');
    expect(names).toContain('getSalesSummary');
    // Nothing that writes to Billz is exposed.
    expect(names.some((name: string) => /create|update|delete|write/i.test(name))).toBe(false);
  });
});
