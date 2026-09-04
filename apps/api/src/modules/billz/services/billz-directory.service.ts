import { BILLZ_ENDPOINTS } from '../client/billz-endpoints.js';
import type { BillzHttpClient } from '../client/billz-http-client.js';
import { fetchAllBillzPages } from '../client/billz-pagination.js';
import type {
  BillzCurrenciesResponse,
  BillzPaymentTypesResponse,
  BillzRawShop,
  BillzShopsResponse,
} from '../client/billz-raw.types.js';
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

  async listShops(): Promise<BillzListResult<BillzShop>> {
    const page = await fetchAllBillzPages<BillzShopsResponse, BillzRawShop>(
      this.client,
      BILLZ_ENDPOINTS.shops,
      (response) => ({ items: response.shops ?? [], total: response.count ?? 0 }),
    );

    return { items: page.items.map(mapShop), total: page.total };
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
