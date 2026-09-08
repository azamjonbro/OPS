import { BILLZ_ENDPOINTS } from '../client/billz-endpoints.js';
import type { BillzHttpClient } from '../client/billz-http-client.js';
import { fetchAllBillzPages } from '../client/billz-pagination.js';
import type {
  BillzCurrenciesResponse,
  BillzPaymentTypesResponse,
  BillzRawShop,
  BillzShopsResponse,
} from '../client/billz-raw.types.js';
import { config } from '../../../config/index.js';
import { mapCurrency, mapPaymentType, mapShop } from '../billz.mapper.js';
import type { BillzCurrency, BillzPaymentType, BillzShop } from '../billz.types.js';
import type { BillzListResult } from './billz-catalog.service.js';

/**
 * The company's own setup: shops (Hadiya calls them branches), the currencies
 * it trades in and the payment methods it accepts. All three are small, slow
 * moving lists that other services resolve names against.
 */
export class BillzDirectoryService {
  constructor(private readonly client: BillzHttpClient) {}

  /**
   * The shops this deployment is allowed to see.
   *
   * `BILLZ_SHOP_IDS` is applied here rather than left to callers, and that is
   * the point: one Billz account can hold several businesses, and a list that
   * named all of them would put shops this deployment has no business
   * reporting on in front of the assistant — which then dutifully includes
   * them in "today's takings". Every other read is already scoped, so leaving
   * this one open made the directory the single way another shop could
   * reappear.
   */
  async listShops(): Promise<BillzListResult<BillzShop>> {
    const page = await fetchAllBillzPages<BillzShopsResponse, BillzRawShop>(
      this.client,
      BILLZ_ENDPOINTS.shops,
      (response) => ({ items: response.shops ?? [], total: response.count ?? 0 }),
    );

    const scope = config.integrations.billz.shopIds;
    const items = page.items
      .map(mapShop)
      .filter((shop) => scope.length === 0 || scope.includes(shop.externalId));

    // The total describes what was returned, not what Billz holds: a caller
    // paging on a count that includes shops it can never see would ask for
    // pages that come back empty.
    return { items, total: scope.length === 0 ? page.total : items.length };
  }

  /** Not paginated upstream: the whole list comes back in one response. */
  async listCurrencies(): Promise<BillzListResult<BillzCurrency>> {
    const response = await this.client.request<BillzCurrenciesResponse>(BILLZ_ENDPOINTS.currencies);
    const raw = response.company_currencies ?? response.currencies ?? [];

    return { items: raw.map(mapCurrency), total: response.count ?? raw.length };
  }

  async listPaymentTypes(): Promise<BillzListResult<BillzPaymentType>> {
    const response = await this.client.request<BillzPaymentTypesResponse>(
      BILLZ_ENDPOINTS.paymentTypes,
    );
    const raw = response.company_payment_types ?? [];

    return { items: raw.map(mapPaymentType), total: response.count ?? raw.length };
  }
}
