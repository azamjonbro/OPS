import { BILLZ_ENDPOINTS } from '../client/billz-endpoints.js';
import type { BillzHttpClient } from '../client/billz-http-client.js';
import { fetchAllBillzPages, fetchBillzPage } from '../client/billz-pagination.js';
import type { BillzClientsResponse, BillzRawClient } from '../client/billz-raw.types.js';
import { mapCustomer } from '../billz.mapper.js';
import type { BillzCustomer } from '../billz.types.js';
import type { BillzListResult } from './billz-catalog.service.js';

export interface CustomerQuery {
  page?: number;
  limit?: number;
  search?: string;
  phone?: string;
}

const extractClients = (response: BillzClientsResponse) => ({
  items: response.clients ?? [],
  total: response.count ?? 0,
});

/**
 * Billz calls them clients; Hadiya calls them customers, and this service is
 * where that translation happens.
 *
 * Read-only on purpose. Billz does expose client create and update, but a
 * customer written from two systems ends up duplicated, so Hadiya owns its own
 * customer records and only reads Billz's.
 */
export class BillzCustomerService {
  constructor(private readonly client: BillzHttpClient) {}

  async listCustomers(query: CustomerQuery = {}): Promise<BillzListResult<BillzCustomer>> {
    const page = await fetchBillzPage<BillzClientsResponse, BillzRawClient>(
      this.client,
      BILLZ_ENDPOINTS.clients,
      extractClients,
      {
        query: {
          page: query.page ?? 1,
          limit: query.limit ?? 50,
          search: query.search,
          phone_number: query.phone,
        },
      },
    );

    return { items: page.items.map(mapCustomer), total: page.total };
  }

  async listAllCustomers(): Promise<BillzListResult<BillzCustomer>> {
    const page = await fetchAllBillzPages<BillzClientsResponse, BillzRawClient>(
      this.client,
      BILLZ_ENDPOINTS.clients,
      extractClients,
    );

    return { items: page.items.map(mapCustomer), total: page.total };
  }

  async searchCustomers(term: string, limit = 20): Promise<BillzListResult<BillzCustomer>> {
    return this.listCustomers({ search: term, limit });
  }

  /** Phone is the identifier a cashier actually has to hand. */
  async findByPhone(phone: string): Promise<BillzCustomer | null> {
    const { items } = await this.listCustomers({ phone, limit: 5 });

    return items[0] ?? null;
  }
}
