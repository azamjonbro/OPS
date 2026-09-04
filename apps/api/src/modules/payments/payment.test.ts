import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import {
  COLA_PRICE,
  createTestBranch,
  createTestCategory,
  createTestProduct,
  signInAs,
} from '../../test/factories.js';
import { CustomerModel } from '../customers/customer.model.js';
import { SaleModel } from '../sales/sale.model.js';

const app = createApp();
const url = '/api/v1/payments';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

/** A part-paid sale: 2 units bought, half the total left owing. */
const setUpPartPaidSale = async () => {
  const branch = await createTestBranch();
  const category = await createTestCategory();
  const product = await createTestProduct(String(category._id));
  const cashier = await signInAs(app, 'cashier', String(branch._id));
  const manager = await signInAs(app, 'manager', String(branch._id));

  await request(app)
    .post('/api/v1/inventory/movements')
    .set('Authorization', manager.authorization)
    .send({ productId: String(product._id), type: 'purchase', quantity: 10 });

  const customer = await request(app)
    .post('/api/v1/customers')
    .set('Authorization', cashier.authorization)
    .send({ fullName: 'Nodira Ismoilova', phone: '+998933334455' });

  const sale = await request(app)
    .post('/api/v1/sales')
    .set('Authorization', cashier.authorization)
    .send({
      customerId: customer.body.data.id,
      items: [{ productId: String(product._id), quantity: 2 }],
      payments: [{ method: 'cash', amount: COLA_PRICE }],
    });

  return { cashier, manager, customerId: customer.body.data.id as string, sale: sale.body.data };
};

describe(`POST ${url}`, () => {
  it('settles the rest of a receipt and clears the customer debt', async () => {
    const { cashier, customerId, sale } = await setUpPartPaidSale();

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ saleId: sale.id, amount: COLA_PRICE, method: 'card', reference: 'TERMINAL-991' });

    expect(response.status).toBe(HTTP_STATUS.CREATED);
    expect(response.body.data).toMatchObject({
      amount: COLA_PRICE,
      method: 'card',
      direction: 'in',
      status: 'completed',
      sale: sale.id,
      customer: customerId,
      reference: 'TERMINAL-991',
    });

    const updated = await SaleModel.findById(sale.id).lean().exec();
    expect(updated).toMatchObject({
      paymentStatus: 'paid',
      totals: expect.objectContaining({ paidAmount: COLA_PRICE * 2, dueAmount: 0 }),
    });

    const customer = await CustomerModel.findById(customerId).lean().exec();
    expect(customer?.debtBalance).toBe(0);
  });

  it('refuses to take more than is still due', async () => {
    const { cashier, sale } = await setUpPartPaidSale();

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ saleId: sale.id, amount: COLA_PRICE * 5, method: 'cash' });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });

  it('requires either a sale or a customer to book the money against', async () => {
    const { cashier } = await setUpPartPaidSale();

    const response = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ amount: 1000, method: 'cash' });

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('is refused without a token', async () => {
    const response = await request(app).post(url).send({ amount: 1000, method: 'cash' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe(`POST ${url}/:id/void`, () => {
  it('reverses the payment and puts the debt back', async () => {
    const { cashier, manager, customerId, sale } = await setUpPartPaidSale();

    const payment = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ saleId: sale.id, amount: COLA_PRICE, method: 'cash' });

    const response = await request(app)
      .post(`${url}/${payment.body.data.id}/void`)
      .set('Authorization', manager.authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.status).toBe('voided');

    const updated = await SaleModel.findById(sale.id).lean().exec();
    expect(updated?.totals.dueAmount).toBe(COLA_PRICE);
    expect(updated?.paymentStatus).toBe('partial');

    const customer = await CustomerModel.findById(customerId).lean().exec();
    expect(customer?.debtBalance).toBe(COLA_PRICE);
  });

  it('is refused for a cashier and cannot be done twice', async () => {
    const { cashier, manager, sale } = await setUpPartPaidSale();

    const payment = await request(app)
      .post(url)
      .set('Authorization', cashier.authorization)
      .send({ saleId: sale.id, amount: COLA_PRICE, method: 'cash' });
    const voidUrl = `${url}/${payment.body.data.id}/void`;

    expect(
      (await request(app).post(voidUrl).set('Authorization', cashier.authorization)).status,
    ).toBe(HTTP_STATUS.FORBIDDEN);
    expect(
      (await request(app).post(voidUrl).set('Authorization', manager.authorization)).status,
    ).toBe(HTTP_STATUS.OK);
    expect(
      (await request(app).post(voidUrl).set('Authorization', manager.authorization)).status,
    ).toBe(HTTP_STATUS.CONFLICT);
  });
});
