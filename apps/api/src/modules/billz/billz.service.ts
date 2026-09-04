import type { AuthenticatedUser } from '@hadiya/shared';

import { assertRole } from '../../core/security/actor.js';
import { createLogger } from '../../core/logger/logger.js';
import { isBillzError } from './client/billz-error.js';
import { BILLZ_CAPABILITIES } from './billz.capabilities.js';
import { checkBillzConnection, getBillzServices } from './services/index.js';
import type {
  BillzCustomerQuery,
  BillzInventoryQuery,
  BillzPeriodQuery,
  BillzProductQuery,
  BillzSalesQuery,
  StartSyncInput,
  SyncLogQuery,
} from './billz.query.types.js';
import { BillzSyncService, listSyncLogs, listSyncState } from './sync/billz-sync.service.js';
import { SYNC_ORDER } from './sync/sync.constants.js';

const log = createLogger('billz');

/**
 * Billz data is company-wide, and its figures are the ones an owner makes
 * decisions on, so reading it is a supervisor's job rather than a till's.
 */
const READ_ROLE = 'manager' as const;
/** Running a sync writes to Hadiya's own catalogue, so it needs an administrator. */
const SYNC_ROLE = 'admin' as const;

/**
 * The module's own service: authorization, and turning integration failures
 * into the API's error vocabulary.
 *
 * Controllers call only this. It is deliberately thin — the Billz knowledge
 * lives in `services/`, and this layer decides who may ask and what a failure
 * looks like from outside.
 */
const guard = async <TResult>(
  actor: AuthenticatedUser,
  role: typeof READ_ROLE | typeof SYNC_ROLE,
  run: () => Promise<TResult> | TResult,
): Promise<TResult> => {
  assertRole(actor, role);

  try {
    return await run();
  } catch (error) {
    if (isBillzError(error)) {
      // One place converts Billz semantics into an HTTP answer, so no
      // controller has to know what a Billz failure looks like.
      throw error.toApiError();
    }

    throw error;
  }
};

export const getStatus = async (actor: AuthenticatedUser) =>
  guard(actor, READ_ROLE, () => checkBillzConnection());

export const listProducts = async (actor: AuthenticatedUser, query: BillzProductQuery) =>
  guard(actor, READ_ROLE, () =>
    getBillzServices().catalog.listProducts({
      page: query.page,
      limit: query.pageSize,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.updatedSince === undefined
        ? {}
        : { updatedSince: query.updatedSince.toISOString() }),
    }),
  );

export const getProduct = async (actor: AuthenticatedUser, externalId: string) =>
  guard(actor, READ_ROLE, () => getBillzServices().catalog.findProduct(externalId));

export const listCategories = async (actor: AuthenticatedUser) =>
  guard(actor, READ_ROLE, () => getBillzServices().catalog.listCategories());

export const listShops = async (actor: AuthenticatedUser) =>
  guard(actor, READ_ROLE, () => getBillzServices().directory.listShops());

export const listPaymentTypes = async (actor: AuthenticatedUser) =>
  guard(actor, READ_ROLE, () => getBillzServices().directory.listPaymentTypes());

export const listCustomers = async (actor: AuthenticatedUser, query: BillzCustomerQuery) =>
  guard(actor, READ_ROLE, () =>
    getBillzServices().customers.listCustomers({
      page: query.page,
      limit: query.pageSize,
      ...(query.search === undefined ? {} : { search: query.search }),
      ...(query.phone === undefined ? {} : { phone: query.phone }),
    }),
  );

export const listSales = async (actor: AuthenticatedUser, query: BillzSalesQuery) =>
  guard(actor, READ_ROLE, () =>
    getBillzServices().sales.listSales({
      from: query.from.toISOString(),
      to: query.to.toISOString(),
      ...(query.shopIds === undefined ? {} : { shopIds: query.shopIds }),
      ...(query.limit === undefined ? {} : { maxItems: query.limit }),
    }),
  );

export const getSale = async (actor: AuthenticatedUser, externalId: string) =>
  guard(actor, READ_ROLE, () => getBillzServices().sales.getSale(externalId));

export const getSalesSummary = async (actor: AuthenticatedUser, query: BillzPeriodQuery) =>
  guard(actor, READ_ROLE, async () => {
    const services = getBillzServices();
    const { items } = await services.sales.listSales({
      from: query.from.toISOString(),
      to: query.to.toISOString(),
    });

    return { period: { from: query.from, to: query.to }, ...services.sales.summarise(items) };
  });

export const getPaymentBreakdown = async (actor: AuthenticatedUser, query: BillzPeriodQuery) =>
  guard(actor, READ_ROLE, () =>
    getBillzServices().finance.paymentBreakdown({
      from: query.from.toISOString(),
      to: query.to.toISOString(),
    }),
  );

export const listDebts = async (actor: AuthenticatedUser, query: BillzPeriodQuery) =>
  guard(actor, READ_ROLE, () =>
    getBillzServices().finance.listDebts({
      from: query.from.toISOString(),
      to: query.to.toISOString(),
    }),
  );

export const listInventory = async (actor: AuthenticatedUser, query: BillzInventoryQuery) =>
  guard(actor, READ_ROLE, () =>
    getBillzServices().inventory.listStock({
      ...(query.shopId === undefined ? {} : { shopId: query.shopId }),
      ...(query.maxQuantity === undefined ? {} : { maxQuantity: query.maxQuantity }),
      ...(query.search === undefined ? {} : { search: query.search }),
    }),
  );

/**
 * Starts a sync and answers immediately.
 *
 * A full catalogue walk takes far longer than a request should, so the run
 * happens in the background and its progress is read back from the sync log.
 * Failures are recorded there rather than thrown at a caller who has already
 * been answered.
 */
export const startSync = async (actor: AuthenticatedUser, input: StartSyncInput) => {
  assertRole(actor, SYNC_ROLE);

  const resources = input.resource ? [input.resource] : [...SYNC_ORDER];
  const sync = new BillzSyncService();

  void (async () => {
    for (const resource of resources) {
      await sync.syncResource(resource, input.mode, actor.id);
    }
  })().catch((error: unknown) => {
    log.error({ err: error }, 'billz sync run failed outside the per-resource handler');
  });

  return {
    accepted: true,
    mode: input.mode,
    resources,
    startedAt: new Date().toISOString(),
  };
};

export const getSyncState = async (actor: AuthenticatedUser) =>
  guard(actor, READ_ROLE, async () => ({ items: await listSyncState() }));

export const getSyncLogs = async (actor: AuthenticatedUser, query: SyncLogQuery) =>
  guard(actor, READ_ROLE, async () => ({
    items: await listSyncLogs(query.resource, query.limit),
  }));

/**
 * The read-only Billz functions the AI agent will be given in the next phase.
 * Exposed over HTTP so the capability list can be reviewed without reading code.
 */
export const listCapabilities = (actor: AuthenticatedUser) => {
  assertRole(actor, READ_ROLE);

  return {
    items: BILLZ_CAPABILITIES.map((capability) => ({
      name: capability.name,
      description: capability.description,
    })),
  };
};
