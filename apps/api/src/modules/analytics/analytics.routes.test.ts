import type { BillzSale } from '../billz/billz.types.js';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { signInAs } from '../../test/factories.js';
import { clearAnalyticsCache } from './analytics.cache.js';

/**
 * The dashboard endpoint, against a scripted Billz.
 *
 * The capability runner is replaced rather than the HTTP client, at exactly the
 * seam the analytics service already has for it, so the request travels the
 * real route: validation, the actor's timezone, the three reads and the shape
 * that reaches the browser.
 *
 * What these cases are really protecting is the screen's honesty. A dashboard
 * that quietly shows a figure it could not compute is worse than one that shows
 * nothing, so the absence of a margin is asserted here as deliberately as the
 * presence of the revenue.
 */
const sales: BillzSale[] = [
  {
    externalId: 's1',
    type: 'sale',
    parentExternalId: null,
    shopExternalId: 'shop-1',
    shopName: 'Store Hadiya',
    customerExternalId: null,
    customerName: null,
    total: 1_200_000,
    debtAmount: 200_000,
    items: [
      {
        productExternalId: 'p1',
        name: 'Tsar Bomba TB8204',
        sku: 'TB8204',
        barcode: null,
        quantity: 2,
        unit: null,
        unitPrice: 600_000,
        discount: 0,
        lineTotal: 1_200_000,
        isReturned: false,
      },
    ],
    payments: [],
    soldAt: '2026-09-06T09:00:00Z',
  },
];

vi.mock('../billz/index.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();

  return {
    ...actual,
    createBillzCapabilityRunner: () => ({
      getSales: async () => ({ items: sales, total: sales.length }),
      getInventory: async () => [
        {
          productExternalId: 'p1',
          productName: 'Tsar Bomba TB8204',
          sku: 'TB8204',
          shopExternalId: 'shop-1',
          shopName: 'Store Hadiya',
          quantity: 3,
          price: 600_000,
        },
      ],
    }),
  };
});

const app = createApp();
const url = '/api/v1/analytics/dashboard';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);

beforeEach(async () => {
  await clearTestDatabase();
  clearAnalyticsCache();
});

afterEach(clearAnalyticsCache);

describe('the dashboard endpoint', () => {
  it('refuses an anonymous request', async () => {
    const response = await request(app).get(url);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('answers with the period’s figures, its top products and what is low', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const response = await request(app)
      .get(`${url}?period=this_month`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);

    const data = response.body.data;

    expect(data.metrics.netSales).toBe(1_200_000);
    expect(data.metrics.saleCount).toBe(1);
    expect(data.metrics.unitsSold).toBe(2);
    expect(data.metrics.outstandingDebt).toBe(200_000);
    expect(data.topProducts[0]).toMatchObject({ name: 'Tsar Bomba TB8204', units: 2 });
    expect(data.lowStock[0]).toMatchObject({ productName: 'Tsar Bomba TB8204', quantity: 3 });
    expect(data.period.key).toBe('this_month');
  });

  it('reports no margin, because no cost of goods reaches this deployment', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const response = await request(app).get(url).set('Authorization', authorization);

    // Billz refuses the API token its transaction endpoint, so there is no cost
    // to subtract. The screen says so; it must never be handed a number.
    expect(response.body.data.metrics).not.toHaveProperty('grossProfit');
    expect(response.body.data).not.toHaveProperty('margin');
  });

  it('measures the period against the one before it', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const response = await request(app)
      .get(`${url}?period=this_week`)
      .set('Authorization', authorization);

    expect(response.body.data.comparison).not.toBeNull();
    expect(response.body.data.comparison.period.days).toBe(response.body.data.period.days);
  });

  it('will not accept a custom period without both dates', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const response = await request(app)
      .get(`${url}?period=custom&from=2026-09-01`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });

  it('refuses a limit beyond the ranking ceiling rather than trusting the query', async () => {
    const { authorization } = await signInAs(app, 'manager', null);

    const response = await request(app)
      .get(`${url}?topLimit=500`)
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });
});
