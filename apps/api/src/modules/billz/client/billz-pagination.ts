import type { BillzHttpClient, BillzRequestOptions } from './billz-http-client.js';

/** Billz caps a page at 500 rows; 200 keeps responses small and steady. */
export const BILLZ_PAGE_SIZE = 200;
/** Hard stop so a bad `count` can never spin forever. */
export const BILLZ_MAX_PAGES = 200;

export interface BillzPage<TItem> {
  items: TItem[];
  /** Total the upstream reports, when it reports one. */
  total: number;
}

export interface PaginatedReadOptions {
  pageSize?: number;
  maxPages?: number;
  /** Stops the walk early — used by incremental sync to bound a run. */
  maxItems?: number;
}

/**
 * Billz paginates with `page` and `limit` and reports a `count`, but the item
 * array lives under a different key per resource, so callers pass an extractor.
 *
 * The walk stops on the first short page, once `count` is covered, or at the
 * page ceiling — never on `count` alone, which has been seen to disagree with
 * the number of rows actually returned.
 */
export const fetchBillzPage = async <TResponse, TItem>(
  client: BillzHttpClient,
  path: string,
  extract: (response: TResponse) => BillzPage<TItem>,
  options: BillzRequestOptions = {},
): Promise<BillzPage<TItem>> => {
  const response = await client.request<TResponse>(path, options);

  return extract(response);
};

export const fetchAllBillzPages = async <TResponse, TItem>(
  client: BillzHttpClient,
  path: string,
  extract: (response: TResponse) => BillzPage<TItem>,
  options: BillzRequestOptions = {},
  paging: PaginatedReadOptions = {},
): Promise<BillzPage<TItem>> => {
  const pageSize = paging.pageSize ?? BILLZ_PAGE_SIZE;
  const maxPages = paging.maxPages ?? BILLZ_MAX_PAGES;
  const items: TItem[] = [];
  let total = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchBillzPage<TResponse, TItem>(client, path, extract, {
      ...options,
      query: { ...options.query, page, limit: pageSize },
    });

    if (page === 1) {
      total = result.total;
    }

    items.push(...result.items);

    if (result.items.length < pageSize) {
      break;
    }

    if (total > 0 && items.length >= total) {
      break;
    }

    if (paging.maxItems !== undefined && items.length >= paging.maxItems) {
      break;
    }
  }

  return { items, total: total || items.length };
};
