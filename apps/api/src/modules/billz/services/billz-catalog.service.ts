import { config } from '../../../config/index.js';
import { BILLZ_ENDPOINTS } from '../client/billz-endpoints.js';
import type { BillzHttpClient } from '../client/billz-http-client.js';
import {
  fetchAllBillzPages,
  fetchBillzPage,
  type PaginatedReadOptions,
} from '../client/billz-pagination.js';
import type {
  BillzBrandsResponse,
  BillzCategoriesResponse,
  BillzProductsResponse,
  BillzRawBrand,
  BillzRawCategory,
  BillzRawProduct,
} from '../client/billz-raw.types.js';
import { mapBrand, mapCategory, mapProduct } from '../billz.mapper.js';
import type { BillzBrand, BillzCategory, BillzProduct } from '../billz.types.js';

export interface BillzListResult<TItem> {
  items: TItem[];
  total: number;
}

export interface ProductQuery {
  page?: number;
  limit?: number;
  /** Billz matches this against the name, SKU and barcode. */
  search?: string;
  /**
   * ISO-8601. Billz returns only products touched at or after this moment,
   * which is what makes an incremental sync possible.
   */
  updatedSince?: string;
}

const extractProducts = (response: BillzProductsResponse) => ({
  items: response.products ?? [],
  total: response.count ?? 0,
});

const extractCategories = (response: BillzCategoriesResponse) => ({
  items: response.categories ?? [],
  total: response.count ?? 0,
});

const extractBrands = (response: BillzBrandsResponse) => ({
  items: response.brands ?? [],
  total: response.count ?? 0,
});

/**
 * The Billz catalogue: products, categories and brands.
 *
 * Everything it returns is already normalised and scoped to the configured
 * shops, so callers — the sync job, the internal API and, later, the AI tools —
 * never see a Billz field name or another shop's stock.
 */
export class BillzCatalogService {
  constructor(private readonly client: BillzHttpClient) {}

  private get shopIds(): string[] {
    return config.integrations.billz.shopIds;
  }

  /** One page, the way a paged UI wants it. */
  async listProducts(query: ProductQuery = {}): Promise<BillzListResult<BillzProduct>> {
    const page = await fetchBillzPage<BillzProductsResponse, BillzRawProduct>(
      this.client,
      BILLZ_ENDPOINTS.products,
      extractProducts,
      {
        query: {
          page: query.page ?? 1,
          limit: query.limit ?? 50,
          search: query.search,
          last_updated_date: query.updatedSince,
        },
      },
    );

    return { items: page.items.map((raw) => mapProduct(raw, this.shopIds)), total: page.total };
  }

  /** Walks every page. Used by the sync, never by a request handler. */
  async listAllProducts(
    query: ProductQuery = {},
    paging: PaginatedReadOptions = {},
  ): Promise<BillzListResult<BillzProduct>> {
    const page = await fetchAllBillzPages<BillzProductsResponse, BillzRawProduct>(
      this.client,
      BILLZ_ENDPOINTS.products,
      extractProducts,
      { query: { search: query.search, last_updated_date: query.updatedSince } },
      paging,
    );

    return { items: page.items.map((raw) => mapProduct(raw, this.shopIds)), total: page.total };
  }

  /**
   * Billz exposes no "product by id" endpoint, so this searches the catalogue
   * and matches on the id. Kept here rather than left to callers, so nobody
   * reimplements it — and it returns `null` rather than throwing, because
   * "not in the catalogue" is an answer, not a failure.
   */
  async findProduct(externalId: string): Promise<BillzProduct | null> {
    const { items } = await this.listAllProducts({}, { maxItems: 5_000 });

    return items.find((product) => product.externalId === externalId) ?? null;
  }

  async searchProducts(term: string, limit = 20): Promise<BillzListResult<BillzProduct>> {
    return this.listProducts({ search: term, limit });
  }

  async listCategories(): Promise<BillzListResult<BillzCategory>> {
    const page = await fetchAllBillzPages<BillzCategoriesResponse, BillzRawCategory>(
      this.client,
      BILLZ_ENDPOINTS.categories,
      extractCategories,
    );

    return { items: page.items.map(mapCategory), total: page.total };
  }

  async listBrands(): Promise<BillzListResult<BillzBrand>> {
    const page = await fetchAllBillzPages<BillzBrandsResponse, BillzRawBrand>(
      this.client,
      BILLZ_ENDPOINTS.brands,
      extractBrands,
    );

    return { items: page.items.map(mapBrand), total: page.total };
  }
}
