import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import {
  COLA_COST,
  COLA_PRICE,
  createTestBranch,
  createTestCategory,
  createTestProduct,
  signInAs,
} from '../../test/factories.js';

const app = createApp();
const url = '/api/v1/products';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

describe(`POST ${url}`, () => {
  it('creates a product with server-side defaults', async () => {
    const category = await createTestCategory();
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({
        name: 'Choy Ahmad 100g',
        sku: 'tea-ahmad-100',
        barcode: '4780012345678',
        categoryId: String(category._id),
        price: COLA_PRICE,
        costPrice: COLA_COST,
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      name: 'Choy Ahmad 100g',
      // The SKU is normalised to upper case so labels and imports match.
      sku: 'TEA-AHMAD-100',
      price: COLA_PRICE,
      currency: 'UZS',
      unit: 'piece',
      trackInventory: true,
      isActive: true,
    });
    // Documents are serialised with `id`, never the raw `_id`.
    expect(response.body.data.id).toEqual(expect.any(String));
    expect(response.body.data._id).toBeUndefined();
  });

  it('refuses a duplicate SKU', async () => {
    const category = await createTestCategory();
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );
    const existing = await createTestProduct(String(category._id));

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({
        name: 'Another product',
        sku: existing.sku,
        categoryId: String(category._id),
        price: 100,
      });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('refuses a category that does not exist', async () => {
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app).post(url).set('Authorization', authorization).send({
      name: 'Orphan',
      sku: 'ORPHAN-1',
      categoryId: '507f1f77bcf86cd799439011',
      price: 100,
    });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('rejects a price that is not an integer number of minor units', async () => {
    const category = await createTestCategory();
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ name: 'Fractional', sku: 'FRAC-1', categoryId: String(category._id), price: 10.5 });

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'price' })]),
    );
  });

  it('is refused for a cashier, who may not edit the catalogue', async () => {
    const category = await createTestCategory();
    const { authorization } = await signInAs(
      app,
      'cashier',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .post(url)
      .set('Authorization', authorization)
      .send({ name: 'Nope', sku: 'NOPE-1', categoryId: String(category._id), price: 100 });

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
  });

  it('is refused without a token', async () => {
    const response = await request(app).post(url).send({ name: 'Anonymous' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe(`PATCH ${url}/:id`, () => {
  it('updates the fields that were sent and leaves the rest alone', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id));
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .patch(`${url}/${String(product._id)}`)
      .set('Authorization', authorization)
      .send({ price: 1_500_000, reorderLevel: 12 });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({
      price: 1_500_000,
      reorderLevel: 12,
      name: product.name,
      sku: product.sku,
    });
  });

  it('ignores an attempt to change the SKU, which is immutable', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id));
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .patch(`${url}/${String(product._id)}`)
      .set('Authorization', authorization)
      .send({ sku: 'CHANGED-SKU' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.sku).toBe(product.sku);
  });

  it('refuses a barcode already used by another product', async () => {
    const category = await createTestCategory();
    const first = await createTestProduct(String(category._id), { barcode: '4780000000001' });
    const second = await createTestProduct(String(category._id));
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .patch(`${url}/${String(second._id)}`)
      .set('Authorization', authorization)
      .send({ barcode: first.barcode });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('deactivates rather than deletes, so past sales keep resolving', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id));
    const { authorization } = await signInAs(
      app,
      'manager',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .delete(`${url}/${String(product._id)}`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.isActive).toBe(false);

    const stillThere = await request(app)
      .get(`${url}/${String(product._id)}`)
      .set('Authorization', authorization);

    expect(stillThere.status).toBe(HTTP_STATUS.OK);
  });
});

describe(`GET ${url}`, () => {
  it('finds a product by barcode', async () => {
    const category = await createTestCategory();
    const product = await createTestProduct(String(category._id), { barcode: '4780099999999' });
    await createTestProduct(String(category._id));
    const { authorization } = await signInAs(
      app,
      'cashier',
      String((await createTestBranch())._id),
    );

    const response = await request(app)
      .get(url)
      .query({ barcode: '4780099999999' })
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.data.items[0].id).toBe(String(product._id));
    expect(response.body.data.pagination).toMatchObject({ total: 1, page: 1 });
  });
});
