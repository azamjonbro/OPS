import { BillzError } from '../client/billz-error.js';
import type { BillzInventoryLevel } from '../billz.types.js';
import type { BillzCatalogService } from './billz-catalog.service.js';

export interface InventoryQuery {
  shopId?: string;
  /** Only rows at or below this quantity — the reorder view. */
  maxQuantity?: number;
  search?: string;
}

export interface BillzInventoryValuation {
  shopId: string | null;
  totalUnits: number;
  /** Retail value of everything on the shelf, in minor units. */
  totalValue: number;
  productCount: number;
}

/**
 * Stock, derived from the catalogue.
 *
 * Billz has no standalone stock endpoint for an API-key role: on-hand
 * quantities arrive inside each product as `shop_measurement_values`. This
 * service turns that nesting into flat per-shop rows so callers can ask "what
 * is low at this shop" without knowing how Billz shapes a product.
 */
export class BillzInventoryService {
  constructor(private readonly catalog: BillzCatalogService) {}

  async listStock(query: InventoryQuery = {}): Promise<BillzInventoryLevel[]> {
    const { items } = await this.catalog.listAllProducts(
      query.search === undefined ? {} : { search: query.search },
    );

    const levels = items.flatMap((product) =>
      product.stock
        .filter((entry) => (query.shopId ? entry.shopId === query.shopId : true))
        .map((entry) => {
          const price =
            product.prices.find((shopPrice) => shopPrice.shopId === entry.shopId)?.retailPrice ??
            product.retailPrice;

          return {
            productExternalId: product.externalId,
            productName: product.name,
            sku: product.sku,
            shopId: entry.shopId,
            shopName: entry.shopName,
            quantity: entry.quantity,
            retailPrice: price,
            stockValue: Math.round(price * entry.quantity),
          };
        }),
    );

    const filtered =
      query.maxQuantity === undefined
        ? levels
        : levels.filter((level) => level.quantity <= (query.maxQuantity ?? 0));

    // Lowest stock first: the reason to open this list is to find what to reorder.
    return filtered.sort((left, right) => left.quantity - right.quantity);
  }

  async valuation(shopId?: string): Promise<BillzInventoryValuation> {
    const levels = await this.listStock(shopId === undefined ? {} : { shopId });

    return levels.reduce<BillzInventoryValuation>(
      (total, level) => ({
        shopId: shopId ?? null,
        totalUnits: total.totalUnits + level.quantity,
        totalValue: total.totalValue + level.stockValue,
        productCount: total.productCount + 1,
      }),
      { shopId: shopId ?? null, totalUnits: 0, totalValue: 0, productCount: 0 },
    );
  }

  async getProductStock(externalId: string): Promise<BillzInventoryLevel[]> {
    const product = await this.catalog.findProduct(externalId);

    if (!product) {
      throw new BillzError('not_found', `Billz has no product ${externalId}`);
    }

    return product.stock.map((entry) => ({
      productExternalId: product.externalId,
      productName: product.name,
      sku: product.sku,
      shopId: entry.shopId,
      shopName: entry.shopName,
      quantity: entry.quantity,
      retailPrice: product.retailPrice,
      stockValue: Math.round(product.retailPrice * entry.quantity),
    }));
  }
}
