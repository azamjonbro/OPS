import { pino } from 'pino';
import { beforeEach, describe, expect, it } from 'vitest';

import { BillzHttpClient } from '../client/billz-http-client.js';
import {
  billzProductFixtures,
  createBillzFetchDouble,
  type ScriptedResponse,
} from '../client/billz-test-double.js';
import { createBillzServices, type BillzServices } from './index.js';

const silentLogger = pino({ level: 'silent' });

const buildServices = (
  script: Array<ScriptedResponse | ((call: { url: string }) => ScriptedResponse)>,
): { services: BillzServices; double: ReturnType<typeof createBillzFetchDouble> } => {
  const double = createBillzFetchDouble(script);
  const client = new BillzHttpClient({
    baseUrl: 'https://api-admin.billz.test',
    secretToken: 'test-secret-token',
    timeoutMs: 5_000,
    maxRetries: 0,
    fetchImpl: double.fetchImpl,
    logger: silentLogger,
    sleep: async () => undefined,
  });

  return { services: createBillzServices(client), double };
};

describe('catalogue normalisation', () => {
  it('turns a Billz product into Hadiya shapes and minor units', async () => {
    const { services } = buildServices([{ body: { count: 1, products: billzProductFixtures(1) } }]);

    const { items, total } = await services.catalog.listProducts();

    expect(total).toBe(1);
    expect(items[0]).toMatchObject({
      externalId: 'billz-product-1',
      name: 'Product 1',
      sku: 'SKU-1',
      categoryName: 'Drinks',
      categoryExternalId: 'billz-category-1',
      unit: 'dona',
      // Billz quotes 12 000 so'm; Hadiya stores integer tiyin.
      retailPrice: 1_200_000,
      supplyPrice: 900_000,
      currency: 'UZS',
      totalStock: 5,
      updatedAt: '2026-09-01T10:00:00Z',
    });
    expect(items[0]?.stock[0]).toEqual({
      shopId: 'shop-1',
      shopName: 'Store Hadiya',
      quantity: 5,
    });
  });

  it('reports a missing optional field as null rather than inventing a value', async () => {
    const { services } = buildServices([
      { body: { count: 1, products: [{ id: 'p1', name: 'Bare product' }] } },
    ]);

    const { items } = await services.catalog.listProducts();

    expect(items[0]).toMatchObject({
      barcode: null,
      description: null,
      brand: null,
      categoryName: null,
      unit: null,
      imageUrl: null,
      updatedAt: null,
      retailPrice: 0,
      totalStock: 0,
    });
  });

  it('passes the incremental cursor to Billz as last_updated_date', async () => {
    const { services, double } = buildServices([{ body: { count: 0, products: [] } }]);

    await services.catalog.listProducts({ updatedSince: '2026-09-01T00:00:00Z' });

    const url = new URL(double.callsTo('/v2/products')[0]?.url ?? '');
    expect(url.searchParams.get('last_updated_date')).toBe('2026-09-01T00:00:00Z');
  });
});

describe('pagination', () => {
  it('walks every page until a short one ends the run', async () => {
    // 200 + 200 + 30: the third page is short, so the walk stops there.
    const { services, double } = buildServices([
      { body: { count: 430, products: billzProductFixtures(200, 0) } },
      { body: { count: 430, products: billzProductFixtures(200, 200) } },
      { body: { count: 430, products: billzProductFixtures(30, 400) } },
    ]);

    const { items, total } = await services.catalog.listAllProducts();

    expect(items).toHaveLength(430);
    expect(total).toBe(430);
    expect(double.callsTo('/v2/products')).toHaveLength(3);

    const pages = double
      .callsTo('/v2/products')
      .map((call) => new URL(call.url).searchParams.get('page'));
    expect(pages).toEqual(['1', '2', '3']);
  });

  it('stops once the reported total is covered, even on a full page', async () => {
    const { services, double } = buildServices([
      { body: { count: 200, products: billzProductFixtures(200) } },
    ]);

    const { items } = await services.catalog.listAllProducts();

    expect(items).toHaveLength(200);
    expect(double.callsTo('/v2/products')).toHaveLength(1);
  });

  it('returns an empty result without failing when there is nothing to read', async () => {
    const { services } = buildServices([{ body: {} }]);

    await expect(services.catalog.listAllProducts()).resolves.toEqual({ items: [], total: 0 });
  });
});

describe('sales normalisation', () => {
  const orderSearchBody = {
    count: 2,
    orders_sorted_by_date_list: [
      {
        date: '2026-09-01',
        orders: [
          {
            id: 'order-1',
            order_type: 'SALE',
            total_price: 24_000,
            shop_id: 'shop-1',
            created_at: '2026-09-01T12:00:00Z',
            customer_id: 'client-1',
            customer: { first_name: 'Dilnoza', last_name: 'Karimova' },
            debt: { amount: 4_000 },
            order_detail: {
              order_items: [
                {
                  product: {
                    id: 'p1',
                    name: 'Cola 1L',
                    sku: 'SKU-1',
                    measurement_unit: { short_name: 'dona' },
                  },
                  measurement_value: 2,
                  sale_price: 12_000,
                  total_price: 24_000,
                  discount_amount: 0,
                },
              ],
            },
          },
          {
            id: 'order-2',
            order_type: 'RETURN',
            total_price: -12_000,
            parent_id: 'order-1',
            is_deleted: false,
            order_detail: {
              order_items: [
                {
                  product: { id: 'p1', name: 'Cola 1L' },
                  measurement_value: 0,
                  returned_measurement_value: 1,
                  sale_price: 12_000,
                  total_price: -12_000,
                  is_returned: true,
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it('flattens the day grouping and normalises both sales and returns', async () => {
    const { services } = buildServices([{ body: orderSearchBody }]);

    const { items } = await services.sales.listSales({
      from: '2026-09-01',
      to: '2026-09-01',
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      externalId: 'order-1',
      type: 'sale',
      total: 2_400_000,
      debtAmount: 400_000,
      customerExternalId: 'client-1',
      customerName: 'Dilnoza Karimova',
    });
    expect(items[0]?.items[0]).toMatchObject({ quantity: 2, unitPrice: 1_200_000, unit: 'dona' });

    // A return reports its units in its own field and points back at the sale.
    expect(items[1]).toMatchObject({ type: 'return', parentExternalId: 'order-1' });
    expect(items[1]?.items[0]).toMatchObject({ quantity: 1, isReturned: true });
  });

  it('nets returns against sales when summarising a period', async () => {
    const { services } = buildServices([{ body: orderSearchBody }]);

    const { items } = await services.sales.listSales({ from: '2026-09-01', to: '2026-09-01' });

    expect(services.sales.summarise(items)).toEqual({
      netTotal: 1_200_000,
      saleCount: 1,
      returnCount: 1,
      outstandingDebt: 400_000,
    });
  });

  it('sends the date window to order search', async () => {
    const { services, double } = buildServices([
      { body: { count: 0, orders_sorted_by_date_list: [] } },
    ]);

    await services.sales.listSales({ from: '2026-09-01', to: '2026-09-07' });

    const url = new URL(double.callsTo('/v3/order-search')[0]?.url ?? '');
    expect(url.searchParams.get('start_date')).toBe('2026-09-01');
    expect(url.searchParams.get('end_date')).toBe('2026-09-07');
  });
});

describe('customers and directory', () => {
  it('joins the two name fields Billz keeps apart', async () => {
    const { services } = buildServices([
      {
        body: {
          count: 1,
          clients: [
            {
              id: 'client-1',
              first_name: 'Aziz',
              last_name: 'Rahimov',
              phone_number: '+998901112233',
            },
          ],
        },
      },
    ]);

    const { items } = await services.customers.listCustomers();

    expect(items[0]).toMatchObject({
      externalId: 'client-1',
      fullName: 'Aziz Rahimov',
      phone: '+998901112233',
    });
  });

  it('reads payment types from the key Billz nests them under', async () => {
    const { services } = buildServices([
      {
        body: {
          count: 2,
          company_payment_types: [
            { id: 'pt-1', name: 'Naqd', is_cash_payment_type: true },
            { id: 'pt-2', name: 'Karta' },
          ],
        },
      },
    ]);

    const { items } = await services.directory.listPaymentTypes();

    expect(items).toEqual([
      { externalId: 'pt-1', name: 'Naqd', isCash: true },
      { externalId: 'pt-2', name: 'Karta', isCash: false },
    ]);
  });
});

describe('inventory derived from the catalogue', () => {
  it('flattens per-shop stock into rows and values them', async () => {
    const { services } = buildServices([{ body: { count: 1, products: billzProductFixtures(1) } }]);

    const levels = await services.inventory.listStock();

    expect(levels).toEqual([
      {
        productExternalId: 'billz-product-1',
        productName: 'Product 1',
        sku: 'SKU-1',
        shopId: 'shop-1',
        shopName: 'Store Hadiya',
        quantity: 5,
        retailPrice: 1_200_000,
        stockValue: 6_000_000,
      },
    ]);
  });
});

describe('expenses', () => {
  let services: BillzServices;

  beforeEach(() => {
    services = buildServices([]).services;
  });

  it('says plainly that Billz will not expose them to an API key', () => {
    // An empty list would read as "no expenses", which is a different claim.
    expect(() => services.finance.listExpenses()).toThrowError(/interactive user session/i);
  });
});
