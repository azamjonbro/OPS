import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import {
  createTestBranch,
  createTestCategory,
  createTestProduct,
  signInAs,
} from '../../test/factories.js';
import { getStockLevel } from './inventory.service.js';

const app = createApp();
const url = '/api/v1/inventory';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const setUp = async (role: 'manager' | 'cashier' = 'manager') => {
  const branch = await createTestBranch();
  const category = await createTestCategory();
  const product = await createTestProduct(String(category._id));
  const { authorization } = await signInAs(app, role, String(branch._id));

  return { branch, product, authorization };
};

describe(`POST ${url}/movements`, () => {
  it('records a purchase and raises the stock level', async () => {
    const { branch, product, authorization } = await setUp();

    const response = await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({
        productId: String(product._id),
        type: 'purchase',
        quantity: 24,
        note: 'Opening stock',
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({ balanceAfter: 24 });
    expect(response.body.data.movement).toMatchObject({
      type: 'purchase',
      quantity: 24,
      balanceAfter: 24,
      reference: { kind: 'manual', id: null },
    });
    await expect(getStockLevel(String(product._id), String(branch._id))).resolves.toBe(24);
  });

  it('keeps a running balance across movements, newest recorded last', async () => {
    const { branch, product, authorization } = await setUp();
    const send = (body: Record<string, unknown>) =>
      request(app)
        .post(`${url}/movements`)
        .set('Authorization', authorization)
        .send({
          productId: String(product._id),
          ...body,
        });

    await send({ type: 'purchase', quantity: 10 });
    await send({ type: 'return', quantity: 2 });
    const last = await send({ type: 'adjustment', quantity: -3 });

    expect(last.body.data.balanceAfter).toBe(9);
    await expect(getStockLevel(String(product._id), String(branch._id))).resolves.toBe(9);
  });

  it('refuses to take more stock than is on hand', async () => {
    const { product, authorization } = await setUp();

    await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({ productId: String(product._id), type: 'purchase', quantity: 2 });

    const response = await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({ productId: String(product._id), type: 'adjustment', quantity: -5 });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    expect(response.body.error.message).toMatch(/not enough stock/i);
  });

  it('will not record a sale movement by hand', async () => {
    const { product, authorization } = await setUp();

    const response = await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({ productId: String(product._id), type: 'sale', quantity: 1 });

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('refuses fractional quantities for a product sold by the piece', async () => {
    const { product, authorization } = await setUp();

    const response = await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({ productId: String(product._id), type: 'purchase', quantity: 1.5 });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('is refused for a cashier', async () => {
    const { product, authorization } = await setUp('cashier');

    const response = await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({ productId: String(product._id), type: 'purchase', quantity: 1 });

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('is refused without a token', async () => {
    const response = await request(app).post(`${url}/movements`).send({ type: 'purchase' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe(`POST ${url}/transfers`, () => {
  it('moves stock between branches as a matched pair of movements', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id));
    const source = await createTestBranch();
    const destination = await createTestBranch();
    const { authorization } = await signInAs(app, 'admin', null);

    await request(app)
      .post(`${url}/movements`)
      .set('Authorization', authorization)
      .send({
        productId: String(product._id),
        branchId: String(source._id),
        type: 'purchase',
        quantity: 8,
      });

    const response = await request(app)
      .post(`${url}/transfers`)
      .set('Authorization', authorization)
      .send({
        productId: String(product._id),
        fromBranchId: String(source._id),
        toBranchId: String(destination._id),
        quantity: 3,
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    await expect(getStockLevel(String(product._id), String(source._id))).resolves.toBe(5);
    await expect(getStockLevel(String(product._id), String(destination._id))).resolves.toBe(3);
  });

  it('leaves both branches untouched when the source has too little stock', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id));
    const source = await createTestBranch();
    const destination = await createTestBranch();
    const { authorization } = await signInAs(app, 'admin', null);

    const response = await request(app)
      .post(`${url}/transfers`)
      .set('Authorization', authorization)
      .send({
        productId: String(product._id),
        fromBranchId: String(source._id),
        toBranchId: String(destination._id),
        quantity: 3,
      });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    await expect(getStockLevel(String(product._id), String(source._id))).resolves.toBe(0);
    await expect(getStockLevel(String(product._id), String(destination._id))).resolves.toBe(0);
  });
});

describe(`GET ${url}/movements`, () => {
  it('returns the stock card for a product, newest first', async () => {
    const { product, authorization } = await setUp();

    for (const quantity of [5, 4]) {
      await request(app)
        .post(`${url}/movements`)
        .set('Authorization', authorization)
        .send({ productId: String(product._id), type: 'purchase', quantity });
    }

    const response = await request(app)
      .get(`${url}/movements`)
      .query({ productId: String(product._id) })
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items).toHaveLength(2);
    expect(
      response.body.data.items.map((item: { balanceAfter: number }) => item.balanceAfter),
    ).toEqual([9, 5]);
  });
});
