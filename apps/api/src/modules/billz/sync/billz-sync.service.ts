import { DEFAULT_CURRENCY } from '@hadiya/shared';
import type { Types } from 'mongoose';

import { createLogger } from '../../../core/logger/logger.js';
import { BranchModel } from '../../branches/branch.model.js';
import { CategoryModel } from '../../categories/category.model.js';
import { CustomerModel } from '../../customers/customer.model.js';
import { ProductModel } from '../../products/product.model.js';
import { isBillzError } from '../client/billz-error.js';
import { getBillzServices, type BillzServices } from '../services/index.js';
import type { BillzCustomer, BillzProduct, BillzShop } from '../billz.types.js';
import { SyncLogModel, type SyncLogDocument } from './sync-log.model.js';
import { SyncStateModel, type SyncStateDocument } from './sync-state.model.js';
import { SYNC_ORDER, type SyncMode, type SyncResource } from './sync.constants.js';
import {
  findLocalId,
  findMappingsByExternalIds,
  hashPayload,
  upsertMapping,
} from './sync-mapping.repository.js';
import type { MappedResource } from './integration-mapping.model.js';

const log = createLogger('billz-sync');

/** Overlap re-read on an incremental run, so a record saved during the previous run is not missed. */
const CURSOR_OVERLAP_MS = 60_000;

export interface SyncCounts {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

export interface SyncRunResult {
  resource: SyncResource;
  mode: SyncMode;
  status: 'succeeded' | 'failed';
  counts: SyncCounts;
  error: string | null;
  durationMs: number;
}

const emptyCounts = (): SyncCounts => ({
  fetched: 0,
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  failed: 0,
});

const readState = async (resource: SyncResource): Promise<SyncStateDocument | null> =>
  SyncStateModel.findOne({ source: 'billz', resource }).lean<SyncStateDocument | null>().exec();

/**
 * Imports Billz data into Hadiya's own collections.
 *
 * Three properties matter and are what the design is built around.
 *
 * *Idempotent*: a record is located by its mapping row, never by name or SKU,
 * so running the same sync twice changes nothing the second time. A content
 * hash means an unchanged record is not even written.
 *
 * *Resumable*: the cursor only advances after a clean run, so a failure repeats
 * its window rather than skipping it. Incremental runs re-read a minute of
 * overlap to cover records saved while the previous run was in flight.
 *
 * *Answerable*: every run writes a log row with counts and any error, and one
 * bad record is counted and stepped over instead of taking the whole run down.
 */
export class BillzSyncService {
  constructor(private readonly services: BillzServices = getBillzServices()) {}

  async syncAll(mode: SyncMode, triggeredBy?: string): Promise<SyncRunResult[]> {
    const results: SyncRunResult[] = [];

    for (const resource of SYNC_ORDER) {
      results.push(await this.syncResource(resource, mode, triggeredBy));
    }

    return results;
  }

  async syncResource(
    resource: SyncResource,
    mode: SyncMode,
    triggeredBy?: string,
  ): Promise<SyncRunResult> {
    const startedAt = new Date();
    const state = await readState(resource);
    const cursorBefore = mode === 'incremental' ? (state?.cursor ?? null) : null;

    const runLog = await SyncLogModel.create({
      source: 'billz',
      resource,
      mode,
      status: 'running',
      startedAt,
      finishedAt: null,
      durationMs: null,
      cursorBefore,
      cursorAfter: null,
      counts: emptyCounts(),
      error: null,
      triggeredBy: triggeredBy ?? null,
    });

    await SyncStateModel.updateOne(
      { source: 'billz', resource },
      { $set: { source: 'billz', resource, lastSyncStartedAt: startedAt } },
      { upsert: true },
    ).exec();

    try {
      const { counts, cursorAfter } = await this.runResource(resource, cursorBefore);
      const durationMs = Date.now() - startedAt.getTime();

      await this.finishRun(runLog._id, 'succeeded', counts, cursorAfter, null, durationMs);
      await SyncStateModel.updateOne(
        { source: 'billz', resource },
        {
          $set: {
            cursor: cursorAfter,
            lastSuccessfulSyncAt: new Date(),
            lastError: null,
            consecutiveFailures: 0,
          },
        },
      ).exec();

      log.info({ resource, mode, counts }, 'billz sync finished');

      return { resource, mode, status: 'succeeded', counts, error: null, durationMs };
    } catch (error) {
      const message = isBillzError(error)
        ? `${error.kind}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'unknown error';
      const durationMs = Date.now() - startedAt.getTime();

      await this.finishRun(runLog._id, 'failed', emptyCounts(), null, message, durationMs);
      await SyncStateModel.updateOne(
        { source: 'billz', resource },
        {
          // The cursor deliberately stays where it was: the next run must cover
          // the window this one failed on.
          $set: { lastFailedSyncAt: new Date(), lastError: message },
          $inc: { consecutiveFailures: 1 },
        },
      ).exec();

      log.error({ resource, mode, err: error }, 'billz sync failed');

      return {
        resource,
        mode,
        status: 'failed',
        counts: emptyCounts(),
        error: message,
        durationMs,
      };
    }
  }

  private async finishRun(
    id: Types.ObjectId,
    status: SyncLogDocument['status'],
    counts: SyncCounts,
    cursorAfter: string | null,
    error: string | null,
    durationMs: number,
  ): Promise<void> {
    await SyncLogModel.updateOne(
      { _id: id },
      { $set: { status, counts, cursorAfter, error, durationMs, finishedAt: new Date() } },
    ).exec();
  }

  private async runResource(
    resource: SyncResource,
    cursorBefore: string | null,
  ): Promise<{ counts: SyncCounts; cursorAfter: string | null }> {
    switch (resource) {
      case 'branches':
        return this.syncBranches();
      case 'categories':
        return this.syncCategories();
      case 'products':
        return this.syncProducts(cursorBefore);
      case 'customers':
        return this.syncCustomers();
    }
  }

  private async syncBranches(): Promise<{ counts: SyncCounts; cursorAfter: string | null }> {
    const counts = emptyCounts();
    const { items } = await this.services.directory.listShops();
    counts.fetched = items.length;

    const mappings = await findMappingsByExternalIds(
      'branch',
      items.map((shop) => shop.externalId),
    );

    for (const shop of items) {
      await this.upsertOne(
        counts,
        'branch',
        shop.externalId,
        shop,
        null,
        mappings,
        async (existingId) => {
          const payload = {
            name: shop.name,
            address: shop.address,
            phone: shop.phone,
            isActive: true,
          };

          if (existingId) {
            await BranchModel.updateOne({ _id: existingId }, { $set: payload }).exec();

            return existingId;
          }

          const created = await BranchModel.create({
            ...payload,
            // Billz has no branch code, so one is derived and made unique by the
            // external id's tail — never by a counter that could collide.
            code: this.deriveBranchCode(shop),
          });

          return created._id;
        },
      );
    }

    return { counts, cursorAfter: null };
  }

  private deriveBranchCode(shop: BillzShop): string {
    const base = shop.name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 16);
    const suffix = shop.externalId
      .replace(/[^a-zA-Z0-9]/g, '')
      .slice(-6)
      .toUpperCase();

    return `${base || 'BILLZ'}-${suffix}`;
  }

  private async syncCategories(): Promise<{ counts: SyncCounts; cursorAfter: string | null }> {
    const counts = emptyCounts();
    const { items } = await this.services.catalog.listCategories();
    counts.fetched = items.length;

    const mappings = await findMappingsByExternalIds(
      'category',
      items.map((category) => category.externalId),
    );

    // Parents first, so a child can resolve its parent in the same run.
    const ordered = [...items].sort((left, right) =>
      left.parentExternalId === null ? -1 : right.parentExternalId === null ? 1 : 0,
    );

    for (const category of ordered) {
      await this.upsertOne(
        counts,
        'category',
        category.externalId,
        category,
        null,
        mappings,
        async (existingId) => {
          const parentId = category.parentExternalId
            ? await findLocalId('category', category.parentExternalId)
            : null;
          const payload = { name: category.name, parent: parentId, isActive: true };

          if (existingId) {
            await CategoryModel.updateOne({ _id: existingId }, { $set: payload }).exec();

            return existingId;
          }

          const created = await CategoryModel.create({ ...payload, description: null });

          return created._id;
        },
      );
    }

    return { counts, cursorAfter: null };
  }

  /**
   * Products are the only resource with a real incremental window: Billz
   * accepts `last_updated_date` on `/v2/products`. The new cursor is the run's
   * start time less a minute of overlap.
   */
  private async syncProducts(
    cursorBefore: string | null,
  ): Promise<{ counts: SyncCounts; cursorAfter: string | null }> {
    const counts = emptyCounts();
    const runStartedAt = Date.now();
    const { items } = await this.services.catalog.listAllProducts(
      cursorBefore ? { updatedSince: cursorBefore } : {},
    );
    counts.fetched = items.length;

    const mappings = await findMappingsByExternalIds(
      'product',
      items.map((product) => product.externalId),
    );

    for (const product of items) {
      const externalUpdatedAt = product.updatedAt ? new Date(product.updatedAt) : null;

      await this.upsertOne(
        counts,
        'product',
        product.externalId,
        product,
        externalUpdatedAt,
        mappings,
        async (existingId) => this.writeProduct(product, existingId),
      );
    }

    return {
      counts,
      cursorAfter: new Date(runStartedAt - CURSOR_OVERLAP_MS).toISOString(),
    };
  }

  private async writeProduct(
    product: BillzProduct,
    existingId: Types.ObjectId | null,
  ): Promise<Types.ObjectId> {
    const categoryId = product.categoryExternalId
      ? await findLocalId('category', product.categoryExternalId)
      : null;

    const payload = {
      name: product.name,
      barcode: product.barcode,
      description: product.description,
      price: product.retailPrice,
      costPrice: product.supplyPrice,
      currency: product.currency || DEFAULT_CURRENCY,
      isActive: true,
      // The link is repeated on the product itself because `externalRefs` is
      // part of the product's public shape; the mapping table stays the source
      // of truth for the sync.
      externalRefs: [
        {
          source: 'billz' as const,
          externalId: product.externalId,
          syncedAt: new Date(),
        },
      ],
    };

    if (existingId) {
      await ProductModel.updateOne(
        { _id: existingId },
        { $set: categoryId ? { ...payload, category: categoryId } : payload },
      ).exec();

      return existingId;
    }

    if (!categoryId) {
      // A product must belong to a category, so one that arrives before its
      // category is skipped and picked up by the next run rather than being
      // filed under an invented one.
      throw new SkippedRecordError(
        `category ${product.categoryExternalId ?? 'missing'} not synced`,
      );
    }

    const created = await ProductModel.create({
      ...payload,
      category: categoryId,
      // Billz SKUs can be blank; the external id keeps the value unique.
      sku: product.sku || `BILLZ-${product.externalId.slice(-10).toUpperCase()}`,
      unit: 'piece',
      trackInventory: true,
      reorderLevel: 0,
      images: product.imageUrl
        ? [{ url: product.imageUrl, alt: null, isPrimary: true, sortOrder: 0 }]
        : [],
    });

    return created._id;
  }

  private async syncCustomers(): Promise<{ counts: SyncCounts; cursorAfter: string | null }> {
    const counts = emptyCounts();
    const { items } = await this.services.customers.listAllCustomers();
    counts.fetched = items.length;

    const mappings = await findMappingsByExternalIds(
      'customer',
      items.map((customer) => customer.externalId),
    );

    for (const customer of items) {
      await this.upsertOne(
        counts,
        'customer',
        customer.externalId,
        customer,
        null,
        mappings,
        async (existingId) => this.writeCustomer(customer, existingId),
      );
    }

    return { counts, cursorAfter: null };
  }

  private async writeCustomer(
    customer: BillzCustomer,
    existingId: Types.ObjectId | null,
  ): Promise<Types.ObjectId> {
    if (!customer.phone) {
      // Phone is Hadiya's customer identity and is uniquely indexed; a Billz
      // client without one cannot be filed.
      throw new SkippedRecordError('customer has no phone number');
    }

    const payload = { fullName: customer.fullName, phone: customer.phone };

    if (existingId) {
      await CustomerModel.updateOne({ _id: existingId }, { $set: payload }).exec();

      return existingId;
    }

    // A customer already registered at the till under the same phone is
    // adopted rather than duplicated.
    const byPhone = await CustomerModel.findOne({ phone: customer.phone })
      .select('_id')
      .lean()
      .exec();

    if (byPhone) {
      return byPhone._id;
    }

    const created = await CustomerModel.create({
      ...payload,
      notes: null,
      status: 'active',
      branch: null,
      debtBalance: 0,
    });

    return created._id;
  }

  /**
   * The shared upsert path: skip when nothing changed, write otherwise, and
   * record the mapping. A record that cannot be filed is counted and stepped
   * over — one bad row must not end the run.
   */
  private async upsertOne<TRecord>(
    counts: SyncCounts,
    resource: MappedResource,
    externalId: string,
    record: TRecord,
    externalUpdatedAt: Date | null,
    mappings: Awaited<ReturnType<typeof findMappingsByExternalIds>>,
    write: (existingId: Types.ObjectId | null) => Promise<Types.ObjectId>,
  ): Promise<void> {
    if (!externalId) {
      counts.skipped += 1;
      return;
    }

    const existing = mappings.get(externalId) ?? null;
    const contentHash = hashPayload(record);

    if (existing && existing.contentHash === contentHash) {
      counts.unchanged += 1;
      return;
    }

    try {
      const localId = await write(existing?.localId ?? null);

      await upsertMapping({ resource, externalId, localId, contentHash, externalUpdatedAt });

      if (existing) {
        counts.updated += 1;
      } else {
        counts.created += 1;
      }
    } catch (error) {
      if (error instanceof SkippedRecordError) {
        counts.skipped += 1;
        log.debug({ resource, externalId, reason: error.message }, 'billz record skipped');
        return;
      }

      counts.failed += 1;
      log.warn({ resource, externalId, err: error }, 'billz record could not be imported');
    }
  }
}

/** A record Hadiya cannot file yet — expected, and not a failure of the run. */
export class SkippedRecordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SkippedRecordError';
  }
}

export const listSyncState = async (): Promise<SyncStateDocument[]> =>
  SyncStateModel.find({ source: 'billz' }).lean<SyncStateDocument[]>().exec();

export const listSyncLogs = async (
  resource: SyncResource | undefined,
  limit: number,
): Promise<SyncLogDocument[]> =>
  SyncLogModel.find({ source: 'billz', ...(resource ? { resource } : {}) })
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean<SyncLogDocument[]>()
    .exec();
