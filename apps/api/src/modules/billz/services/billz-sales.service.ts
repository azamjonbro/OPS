import { config } from '../../../config/index.js';
import { BILLZ_ENDPOINTS } from '../client/billz-endpoints.js';
import { BillzError } from '../client/billz-error.js';
import type { BillzHttpClient } from '../client/billz-http-client.js';
import { fetchAllBillzPages } from '../client/billz-pagination.js';
import type {
  BillzOrderResponse,
  BillzOrderSearchResponse,
  BillzRawOrder,
} from '../client/billz-raw.types.js';
import { mapSale } from '../billz.mapper.js';
import type { BillzSale } from '../billz.types.js';
import type { BillzListResult } from './billz-catalog.service.js';

export interface SalesQuery {
  /** ISO-8601 date or date-time. */
  from: string;
  to: string;
  shopIds?: string[];
  /** Restricts the result to receipts settled with these payment methods. */
  paymentTypeIds?: string[];
  maxItems?: number;
}

export interface BillzSalesSummary {
  /** Receipts less returns, in minor units. */
  netTotal: number;
  saleCount: number;
  returnCount: number;
  /** Money left unpaid on credit receipts. */
  outstandingDebt: number;
}

/**
 * The receipt log — the only trustworthy record of what Billz actually sold.
 *
 * An earlier implementation inferred sales from a product's `updated_at`, which
 * also moves on restocks and price edits and so counted arriving inventory as
 * revenue. This reads `/v3/order-search`, where a receipt is a receipt.
 */
export class BillzSalesService {
  constructor(private readonly client: BillzHttpClient) {}

  private resolveShopIds(requested: string[] | undefined): string[] {
    const configured = config.integrations.billz.shopIds;

    if (!requested || requested.length === 0) {
      return configured;
    }

    if (configured.length === 0) {
      return requested;
    }

    // A caller may narrow the configured scope, never widen it.
    return requested.filter((shopId) => configured.includes(shopId));
  }

  async listSales(query: SalesQuery): Promise<BillzListResult<BillzSale>> {
    const shopIds = this.resolveShopIds(query.shopIds);

    const page = await fetchAllBillzPages<BillzOrderSearchResponse, BillzRawOrder>(
      this.client,
      BILLZ_ENDPOINTS.orderSearch,
      (response) => ({
        // Order search groups by day, so the orders sit one level deeper than
        // in every other Billz list response.
        items: (response.orders_sorted_by_date_list ?? []).flatMap((day) => day.orders ?? []),
        total: response.count ?? 0,
      }),
      {
        query: {
          start_date: query.from,
          end_date: query.to,
          shop_ids: shopIds.length > 0 ? shopIds.join(',') : undefined,
          company_payment_type_ids:
            query.paymentTypeIds && query.paymentTypeIds.length > 0
              ? query.paymentTypeIds.join(',')
              : undefined,
        },
      },
      { ...(query.maxItems === undefined ? {} : { maxItems: query.maxItems }) },
    );

    const items = page.items
      .filter((order) => order.is_deleted !== true)
      .map((order) => mapSale(order));

    return { items, total: page.total || items.length };
  }

  async getSale(externalId: string): Promise<BillzSale> {
    const response = await this.client.request<BillzOrderResponse>(
      BILLZ_ENDPOINTS.order(externalId),
    );
    const raw = response.order ?? response.data;

    if (!raw?.id) {
      throw new BillzError('not_found', `Billz has no order ${externalId}`, {
        endpoint: BILLZ_ENDPOINTS.order(externalId),
      });
    }

    return mapSale(raw);
  }

  /**
   * Totals a period. Returns carry a negative total in Billz, so netting is a
   * plain sum — no separate subtraction that could be applied twice.
   */
  summarise(sales: BillzSale[]): BillzSalesSummary {
    return sales.reduce<BillzSalesSummary>(
      (summary, sale) => ({
        netTotal: summary.netTotal + sale.total,
        saleCount: summary.saleCount + (sale.type === 'sale' ? 1 : 0),
        returnCount: summary.returnCount + (sale.type === 'return' ? 1 : 0),
        outstandingDebt: summary.outstandingDebt + (sale.debtAmount ?? 0),
      }),
      { netTotal: 0, saleCount: 0, returnCount: 0, outstandingDebt: 0 },
    );
  }

  /**
   * Which receipts were settled with which payment method.
   *
   * A Billz order carries no payment method of its own — verified field by
   * field against both `/v3/order-search` and `/v2/order/{id}` — and the report
   * endpoints that would answer this are refused to an API-key role. Order
   * search does accept a `company_payment_type_ids` filter, so asking once per
   * method and collecting the ids reconstructs the split from data Billz
   * actually gives us. Receipts that match no method are credit sales.
   */
  async listSaleIdsByPaymentType(
    query: Omit<SalesQuery, 'paymentTypeIds'>,
    paymentTypeId: string,
  ): Promise<Set<string>> {
    const { items } = await this.listSales({ ...query, paymentTypeIds: [paymentTypeId] });

    return new Set(items.map((sale) => sale.externalId));
  }
}
