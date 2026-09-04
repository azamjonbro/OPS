import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { supportsTransactions } from '../../core/db/transaction.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import {
  COLA_PRICE,
  createTestBranch,
  createTestCategory,
  createTestProduct,
  signInAs,
} from '../../test/factories.js';
import { CustomerModel } from '../customers/customer.model.js';
import { getStockLevel } from '../inventory/inventory.service.js';
import { PaymentModel } from '../payments/payment.model.js';
import { SaleModel } from './sale.model.js';

const app = createApp();
const url = '/api/v1/sales';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

/** A branch with a signed-in cashier and one product holding `stock` units. */
const setUp = async (stock = 10) => {
  const branch = await createTestBranch();
  const category = await createTestCategory();
  const product = await createTestProduct(String(category._id));
  const cashier = await signInAs(app, 'cashier', String(branch._id));
  const manager = await signInAs(app, 'manager', String(branch._id));

  if (stock > 0) {
    await request(app)
      .post('/api/v1/inventory/movements')
      .set('Authorization', manager.authorization)
      .send({ productId: String(product._id), type: 'purchase', quantity: stock });
  }

  return { branch, product, cashier, manager };
};

const addCustomer = async (app_: typeof app, authorization: string, phone = '+998901234599') => {
  const response = await request(app_)
    .post('/api/v1/customers')
    .set('Authorization', authorization)
    .send({ fullName: 'Sardor Yusupov', phone });

  return response.body.data.id as string;
};

describe(`POST ${url}`, () => {
  it('rings up a sale, prices it from the catalogue and takes the stock', async () => {
    const { branch, product, cashier } = await setUp(10);

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 3 }],
        payments: [{ method: 'cash', amount: COLA_PRICE * 3 }],
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      status: 'completed',
      paymentStatus: 'paid',
      branch: String(branch._id),
      employee: String(cashier.user._id),
      totals: {
        subtotal: COLA_PRICE * 3,
        discountTotal: 0,
        grandTotal: COLA_PRICE * 3,
        paidAmount: COLA_PRICE * 3,
        dueAmount: 0,
      },
    });
    expect(response.body.data.number).toMatch(/^BR[A-Z0-9]+-\d{8}-0001$/);

    // The line is a snapshot of what was charged, plus a link to the product.
    expect(response.body.data.items[0]).toMatchObject({
      product: String(product._id),
      name: product.name,
      sku: product.sku,
      unitPrice: COLA_PRICE,
      quantity: 3,
      lineTotal: COLA_PRICE * 3,
    });

    await expect(getStockLevel(String(product._id), String(branch._id))).resolves.toBe(7);
  });

  it('writes a sale movement that points back at the receipt', async () => {
    const { branch, product, cashier } = await setUp(5);

    const sale = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 2 }],
        payments: [{ method: 'cash', amount: COLA_PRICE * 2 }],
      });

    const movements = await request(app)
      .get('/api/v1/inventory/movements')
      .query({ productId: String(product._id), type: 'sale' })
      .set('Authorization', cashier.authorization);

    expect(movements.body.data.items).toHaveLength(1);
    expect(movements.body.data.items[0]).toMatchObject({
      quantity: -2,
      balanceAfter: 3,
      branch: String(branch._id),
      reference: { kind: 'sale', id: sale.body.data.id },
    });
  });

  it('applies a line discount and never trusts a price sent by the client', async () => {
    const { product, cashier } = await setUp(5);

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 2, discount: 200_000 }],
        payments: [{ method: 'cash', amount: COLA_PRICE * 2 - 200_000 }],
        // A price sent by the client is simply not part of the contract.
        price: 1,
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data.totals).toMatchObject({
      subtotal: COLA_PRICE * 2,
      discountTotal: 200_000,
      grandTotal: COLA_PRICE * 2 - 200_000,
    });
  });

  it('refuses to sell more than the branch holds, and takes no stock', async () => {
    const { branch, product, cashier } = await setUp(2);

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 5 }],
        payments: [{ method: 'cash', amount: COLA_PRICE * 5 }],
      });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    await expect(getStockLevel(String(product._id), String(branch._id))).resolves.toBe(2);
    await expect(SaleModel.countDocuments().exec()).resolves.toBe(0);
  });

  it('rolls the whole sale back when a later line runs out of stock', async () => {
    const { branch, product, cashier, manager } = await setUp(10);
    const category = await createTestCategory();
    const scarce = await createTestProduct(String(category._id), { sku: 'SCARCE-1' });

    await request(app)
      .post('/api/v1/inventory/movements')
      .set('Authorization', manager.authorization)
      .send({ productId: String(scarce._id), type: 'purchase', quantity: 1 });

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [
          { productId: String(product._id), quantity: 2 },
          { productId: String(scarce._id), quantity: 5 },
        ],
        payments: [{ method: 'cash', amount: COLA_PRICE * 7 }],
      });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
    await expect(SaleModel.countDocuments().exec()).resolves.toBe(0);

    // With a transactional deployment the first line's stock is restored too.
    if (supportsTransactions()) {
      await expect(getStockLevel(String(product._id), String(branch._id))).resolves.toBe(10);
    }

    await expect(getStockLevel(String(scarce._id), String(branch._id))).resolves.toBe(1);
  });

  it('puts an unpaid balance on the customer account', async () => {
    const { product, cashier } = await setUp(10);
    const customerId = await addCustomer(app, cashier.authorization);

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        customerId,
        items: [{ productId: String(product._id), quantity: 2 }],
        payments: [{ method: 'cash', amount: COLA_PRICE }],
      });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      paymentStatus: 'partial',
      totals: { paidAmount: COLA_PRICE, dueAmount: COLA_PRICE },
    });

    const customer = await CustomerModel.findById(customerId).lean().exec();
    expect(customer?.debtBalance).toBe(COLA_PRICE);
  });

  it('will not leave a balance unpaid without a customer to bill', async () => {
    const { product, cashier } = await setUp(10);

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ items: [{ productId: String(product._id), quantity: 1 }] });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(response.body.error.message).toMatch(/attached to a customer/i);
  });

  it('rejects payments larger than the sale total', async () => {
    const { product, cashier } = await setUp(10);

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 1 }],
        payments: [{ method: 'cash', amount: COLA_PRICE * 5 }],
      });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('is refused without a token', async () => {
    const response = await request(app).post(url).send({ items: [] });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe(`POST ${url}/:id/cancel`, () => {
  it('returns the stock, voids the payments and clears the debt', async () => {
    const { branch, product, cashier, manager } = await setUp(10);
    const customerId = await addCustomer(app, cashier.authorization);

    const sale = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        customerId,
        items: [{ productId: String(product._id), quantity: 4 }],
        payments: [{ method: 'cash', amount: COLA_PRICE }],
      });

    const response = await request(app)
      .post(`${url}/${sale.body.data.id}/cancel`)
      .set('Authorization', manager.authorization)
      .send({ reason: 'Customer changed their mind' });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.status).toBe('cancelled');

    await expect(getStockLevel(String(product._id), String(branch._id))).resolves.toBe(10);

    const payments = await PaymentModel.find({ sale: sale.body.data.id }).lean().exec();
    expect(payments.every((payment) => payment.status === 'voided')).toBe(true);

    const customer = await CustomerModel.findById(customerId).lean().exec();
    expect(customer?.debtBalance).toBe(0);
  });

  it('is refused for a cashier', async () => {
    const { product, cashier } = await setUp(10);

    const sale = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 1 }],
        payments: [{ method: 'cash', amount: COLA_PRICE }],
      });

    const response = await request(app)
      .post(`${url}/${sale.body.data.id}/cancel`)
      .set('Authorization', cashier.authorization)
      .send({ reason: 'Trying to undo my own sale' });

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
  });

  it('cannot be cancelled twice', async () => {
    const { product, cashier, manager } = await setUp(10);

    const sale = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 1 }],
        payments: [{ method: 'cash', amount: COLA_PRICE }],
      });

    const cancel = () =>
      request(app)
        .post(`${url}/${sale.body.data.id}/cancel`)
        .set('Authorization', manager.authorization)
        .send({ reason: 'Duplicate receipt' });

    expect((await cancel()).status).toBe(HTTP_STATUS.OK);
    expect((await cancel()).status).toBe(HTTP_STATUS.CONFLICT);
  });
});

describe(`GET ${url}`, () => {
  it('does not show a cashier the sales of another branch', async () => {
    const { product, cashier } = await setUp(10);
    const otherBranch = await createTestBranch();
    const outsider = await signInAs(app, 'cashier', String(otherBranch._id));

    await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({
        items: [{ productId: String(product._id), quantity: 1 }],
        payments: [{ method: 'cash', amount: COLA_PRICE }],
      });

    const mine = await request(app).get(url).set('Authorization', cashier.authorization);
    const theirs = await request(app).get(url).set('Authorization', outsider.authorization);

    expect(mine.body.data.items).toHaveLength(1);
    expect(theirs.body.data.items).toHaveLength(0);
  });
});
