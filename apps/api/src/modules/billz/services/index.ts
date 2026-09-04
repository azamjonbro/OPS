import { config } from '../../../config/index.js';
import { BILLZ_ENDPOINTS } from '../client/billz-endpoints.js';
import { BillzError, isBillzError } from '../client/billz-error.js';
import { getBillzHttpClient, type BillzHttpClient } from '../client/billz-http-client.js';
import type { BillzConnectionStatus } from '../billz.types.js';
import { BillzCatalogService } from './billz-catalog.service.js';
import { BillzCustomerService } from './billz-customer.service.js';
import { BillzDirectoryService } from './billz-directory.service.js';
import { BillzFinanceService } from './billz-finance.service.js';
import { BillzInventoryService } from './billz-inventory.service.js';
import { BillzSalesService } from './billz-sales.service.js';

/**
 * Every Billz capability, assembled once.
 *
 * This is the seam the rest of Hadiya depends on: the internal API, the sync
 * job and, in the next phase, the AI tools all take this object. Nothing above
 * it knows that Billz speaks HTTP.
 */
export interface BillzServices {
  catalog: BillzCatalogService;
  directory: BillzDirectoryService;
  customers: BillzCustomerService;
  sales: BillzSalesService;
  inventory: BillzInventoryService;
  finance: BillzFinanceService;
}

export const createBillzServices = (client: BillzHttpClient): BillzServices => {
  const catalog = new BillzCatalogService(client);
  const directory = new BillzDirectoryService(client);
  const sales = new BillzSalesService(client);

  return {
    catalog,
    directory,
    customers: new BillzCustomerService(client),
    sales,
    inventory: new BillzInventoryService(catalog),
    finance: new BillzFinanceService(sales, directory),
  };
};

let cached: BillzServices | null = null;

/**
 * The process-wide services. Throws a `not_configured` error rather than
 * returning a half-built object when no token is set, so a missing credential
 * fails at the boundary with one clear message.
 */
export const getBillzServices = (): BillzServices => {
  cached ??= createBillzServices(getBillzHttpClient());

  return cached;
};

export const resetBillzServices = (): void => {
  cached = null;
};

/**
 * Whether the integration is usable right now. Reads the smallest thing Billz
 * offers — one page of one shop — so a status check costs almost nothing.
 */
export const checkBillzConnection = async (): Promise<BillzConnectionStatus> => {
  const base = {
    configured: config.integrations.billz.configured,
    baseUrl: config.integrations.billz.baseUrl,
    checkedAt: new Date().toISOString(),
  };

  if (!base.configured) {
    return { ...base, connected: false, error: 'BILLZ_API_TOKEN is not set' };
  }

  try {
    await getBillzHttpClient().request(BILLZ_ENDPOINTS.shops, { query: { page: 1, limit: 1 } });

    return { ...base, connected: true, error: null };
  } catch (error) {
    if (isBillzError(error)) {
      return { ...base, connected: false, error: `${error.kind}: ${error.message}` };
    }

    throw error;
  }
};

export { BillzError };
export type { BillzHttpClient };
export {
  BillzCatalogService,
  BillzCustomerService,
  BillzDirectoryService,
  BillzFinanceService,
  BillzInventoryService,
  BillzSalesService,
};
export type { BillzListResult, ProductQuery } from './billz-catalog.service.js';
export type { CustomerQuery } from './billz-customer.service.js';
export type { SalesQuery, BillzSalesSummary } from './billz-sales.service.js';
export type { InventoryQuery, BillzInventoryValuation } from './billz-inventory.service.js';
export type {
  BillzPaymentBreakdown,
  BillzPaymentBreakdownRow,
  BillzDebtRow,
} from './billz-finance.service.js';
