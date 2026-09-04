import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../../test/database.js';
import { CategoryModel } from '../../categories/category.model.js';
import { CustomerModel } from '../../customers/customer.model.js';
import { ProductModel } from '../../products/product.model.js';
import { BranchModel } from '../../branches/branch.model.js';
import type { BillzServices } from '../services/index.js';
import type { BillzCategory, BillzCustomer, BillzProduct, BillzShop } from '../billz.types.js';
import { BillzSyncService } from './billz-sync.service.js';
import { IntegrationMappingModel } from './integration-mapping.model.js';
import { SyncLogModel } from './sync-log.model.js';
import { SyncStateModel } from './sync-state.model.js';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

const shop = (overrides: Partial<BillzShop> = {}): BillzShop => ({
  externalId: 'billz-shop-1',
  name: 'Store Hadiya',
  address: 'Bunyodkor 12',
  phone: '+998901234567',
  legalName: null,
  taxNumber: null,
  ...overrides,
});

const category = (overrides: Partial<BillzCategory> = {}): BillzCategory => ({
  externalId: 'billz-category-1',
  name: 'Ichimliklar',
  parentExternalId: null,
  productCount: 4,
  ...overrides,
});

const product = (overrides: Partial<BillzProduct> = {}): BillzProduct => ({
  externalId: 'billz-product-1',
  name: 'Cola 1L',
  sku: 'COLA-1L',
  barcode: '4780012345678',
  description: null,
  brand: null,
  categoryName: 'Ichimliklar',
  categoryExternalId: 'billz-category-1',
  unit: 'dona',
  imageUrl: null,
  retailPrice: 1_200_000,
  supplyPrice: 900_000,
  currency: 'UZS',
  prices: [],
  stock: [],
  totalStock: 0,
  updatedAt: '2026-09-01T10:00:00Z',
  ...overrides,
});

const customer = (overrides: Partial<BillzCustomer> = {}): BillzCustomer => ({
  externalId: 'billz-client-1',
  fullName: 'Dilnoza Karimova',
  phone: '+998901112233',
  gender: null,
  dateOfBirth: null,
  createdAt: null,
  ...overrides,
});

/** A services object whose reads are fixtures; no HTTP is involved. */
const stubServices = (data: {
  shops?: BillzShop[];
  categories?: BillzCategory[];
  products?: BillzProduct[];
  customers?: BillzCustomer[];
  productError?: Error;
}): BillzServices => {
  const list = <TItem>(items: TItem[]) => ({ items, total: items.length });

  return {
    directory: { listShops: async () => list(data.shops ?? []) },
    catalog: {
      listCategories: async () => list(data.categories ?? []),
      listAllProducts: async () => {
        if (data.productError) {
          throw data.productError;
        }

        return list(data.products ?? []);
      },
    },
    customers: { listAllCustomers: async () => list(data.customers ?? []) },
  } as unknown as BillzServices;
};

describe('external id mapping', () => {
  it('links a Billz record to a Hadiya record without ever reusing its id', async () => {
    const sync = new BillzSyncService(stubServices({ shops: [shop()] }));

    await sync.syncResource('branches', 'full');

    const mapping = await IntegrationMappingModel.findOne({ resource: 'branch' }).lean().exec();
    const branch = await BranchModel.findOne({ name: 'Store Hadiya' }).lean().exec();

    expect(mapping).toMatchObject({ source: 'billz', externalId: 'billz-shop-1' });
    expect(String(mapping?.localId)).toBe(String(branch?._id));
    // The Billz id is a string of its own; it is never used as a Mongo id.
    expect(String(branch?._id)).not.toBe('billz-shop-1');
  });

  it('updates the same record on a second run instead of duplicating it', async () => {
    const sync = new BillzSyncService(stubServices({ shops: [shop()] }));
    await sync.syncResource('branches', 'full');

    const renamed = new BillzSyncService(
      stubServices({ shops: [shop({ name: 'Store Hadiya Chilonzor' })] }),
    );
    const second = await renamed.syncResource('branches', 'full');

    expect(await BranchModel.countDocuments().exec()).toBe(1);
    expect(second.counts).toMatchObject({ fetched: 1, created: 0, updated: 1 });
    expect((await BranchModel.findOne().lean().exec())?.name).toBe('Store Hadiya Chilonzor');
  });

  it('skips a record that has not changed rather than rewriting it', async () => {
    const services = stubServices({ shops: [shop()] });
    const sync = new BillzSyncService(services);

    await sync.syncResource('branches', 'full');
    const second = await sync.syncResource('branches', 'full');

    expect(second.counts).toMatchObject({ fetched: 1, created: 0, updated: 0, unchanged: 1 });
  });

  it('resolves a product category through the mapping table', async () => {
    const sync = new BillzSyncService(
      stubServices({ categories: [category()], products: [product()] }),
    );

    await sync.syncResource('categories', 'full');
    const result = await sync.syncResource('products', 'full');

    const saved = await ProductModel.findOne({ sku: 'COLA-1L' }).lean().exec();
    const savedCategory = await CategoryModel.findOne({ name: 'Ichimliklar' }).lean().exec();

    expect(result.counts).toMatchObject({ created: 1, failed: 0 });
    expect(String(saved?.category)).toBe(String(savedCategory?._id));
    expect(saved?.price).toBe(1_200_000);
    // The link is mirrored onto the product itself for clients that read it.
    expect(saved?.externalRefs[0]).toMatchObject({
      source: 'billz',
      externalId: 'billz-product-1',
    });
  });

  it('skips a product whose category has not been synced yet', async () => {
    const sync = new BillzSyncService(stubServices({ products: [product()] }));

    const result = await sync.syncResource('products', 'full');

    expect(result.counts).toMatchObject({ fetched: 1, created: 0, skipped: 1 });
    expect(await ProductModel.countDocuments().exec()).toBe(0);
  });

  it('adopts a customer already registered at the till under the same phone', async () => {
    const existing = await CustomerModel.create({
      fullName: 'Dilnoza K.',
      phone: '+998901112233',
      notes: null,
      status: 'active',
      branch: null,
      debtBalance: 0,
    });

    const sync = new BillzSyncService(stubServices({ customers: [customer()] }));
    await sync.syncResource('customers', 'full');

    expect(await CustomerModel.countDocuments().exec()).toBe(1);
    const mapping = await IntegrationMappingModel.findOne({ resource: 'customer' }).lean().exec();
    expect(String(mapping?.localId)).toBe(String(existing._id));
  });

  it('skips a Billz customer with no phone number, which Hadiya requires', async () => {
    const sync = new BillzSyncService(stubServices({ customers: [customer({ phone: null })] }));

    const result = await sync.syncResource('customers', 'full');

    expect(result.counts).toMatchObject({ fetched: 1, skipped: 1, created: 0 });
  });
});

describe('sync state and logs', () => {
  it('records a run with its counts', async () => {
    const sync = new BillzSyncService(stubServices({ shops: [shop()] }));

    await sync.syncResource('branches', 'full');

    const logs = await SyncLogModel.find({ resource: 'branches' }).lean().exec();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      status: 'succeeded',
      mode: 'full',
      counts: expect.objectContaining({ fetched: 1, created: 1 }),
      error: null,
    });
    expect(logs[0]?.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('advances the product cursor only after a successful run', async () => {
    const sync = new BillzSyncService(
      stubServices({ categories: [category()], products: [product()] }),
    );

    await sync.syncResource('categories', 'full');
    await sync.syncResource('products', 'incremental');

    const state = await SyncStateModel.findOne({ resource: 'products' }).lean().exec();
    expect(state?.cursor).toEqual(expect.any(String));
    expect(state?.consecutiveFailures).toBe(0);
    expect(state?.lastSuccessfulSyncAt).toBeInstanceOf(Date);
  });

  it('keeps the cursor where it was when a run fails, so the window is retried', async () => {
    const ok = new BillzSyncService(
      stubServices({ categories: [category()], products: [product()] }),
    );
    await ok.syncResource('categories', 'full');
    await ok.syncResource('products', 'incremental');
    const cursorBefore = (await SyncStateModel.findOne({ resource: 'products' }).lean().exec())
      ?.cursor;

    const failing = new BillzSyncService(
      stubServices({ productError: new Error('billz is down') }),
    );
    const result = await failing.syncResource('products', 'incremental');

    const state = await SyncStateModel.findOne({ resource: 'products' }).lean().exec();
    expect(result.status).toBe('failed');
    expect(result.error).toContain('billz is down');
    expect(state?.cursor).toBe(cursorBefore);
    expect(state?.consecutiveFailures).toBe(1);
    expect(state?.lastError).toContain('billz is down');

    const failedLog = await SyncLogModel.findOne({ status: 'failed' }).lean().exec();
    expect(failedLog).toMatchObject({ resource: 'products', error: expect.any(String) });
  });

  it('runs every resource in dependency order', async () => {
    const sync = new BillzSyncService(
      stubServices({
        shops: [shop()],
        categories: [category()],
        products: [product()],
        customers: [customer()],
      }),
    );

    const results = await sync.syncAll('full');

    expect(results.map((result) => result.resource)).toEqual([
      'branches',
      'categories',
      'products',
      'customers',
    ]);
    expect(results.every((result) => result.status === 'succeeded')).toBe(true);
    // Products land because their category was imported first.
    expect(await ProductModel.countDocuments().exec()).toBe(1);
  });
});
