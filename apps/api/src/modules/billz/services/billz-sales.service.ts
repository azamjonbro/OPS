import { config } from '../../../config/index.js';
import { createLogger } from '../../../core/logger/logger.js';
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
      // Billz reports deletion as `deleted`. The previous name did not exist on
      // the payload, so this filter matched everything and voided receipts were
      // being counted as trade.
      .filter((order) => order.deleted !== true)
      .map((order) => mapSale(order));

    // The scope is asked for *and* enforced. `shop_ids` in the request is what
    // keeps it small; this is what makes it true. A report that widened because
    // an upstream filter was renamed, ignored on one endpoint version or served
    // from a cache would put another shop's receipts in this shop's takings,
    // with a plausible total and nothing on screen to say so — so the verdict
    // is taken from each receipt's own shop, which cannot be a filtering
    // mistake.
    const inScope =
      shopIds.length === 0
        ? items
        : items.filter(
            (sale) => sale.shopExternalId !== null && shopIds.includes(sale.shopExternalId),
          );

    // A receipt with no shop on it is excluded, because it cannot be shown to
    // belong here — but never silently: under-reporting a day's takings is its
    // own kind of wrong, and this is the line that makes it findable.
    const unattributed = items.filter((sale) => sale.shopExternalId === null).length;

    if (shopIds.length > 0 && unattributed > 0) {
      createLogger('billz').warn(
        { from: query.from, to: query.to, unattributed },
        'Billz returned receipts with no shop id; they are excluded from a shop-scoped read',
      );
    }

    // `count` is Billz's tally for the whole query; once rows have been dropped
    // it no longer describes what came back.
    return { items: inScope, total: inScope.length };
  }

  /**
   * One receipt by its Billz id.
   *
   * Billz will hand over any receipt in the company, so the scope has to be
   * applied *after* the read: `/v2/order/{id}` takes no `shop_ids`. A receipt
   * from a shop outside `BILLZ_SHOP_IDS` is reported as not found rather than
   * as forbidden, because as far as this deployment is concerned it is not
   * there — and saying "that belongs to another shop" would confirm the id
   * exists to whoever guessed it.
   */
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

    const sale = mapSale(raw);
    const scope = config.integrations.billz.shopIds;

    if (
      scope.length > 0 &&
      (sale.shopExternalId === null || !scope.includes(sale.shopExternalId))
    ) {
      throw new BillzError('not_found', `Billz has no order ${externalId}`, {
        endpoint: BILLZ_ENDPOINTS.order(externalId),
      });
    }

    return sale;
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
}
