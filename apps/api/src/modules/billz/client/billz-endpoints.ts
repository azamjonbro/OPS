/**
 * Every Billz path Hadiya calls, in one place.
 *
 * Nothing here is guessed. Each entry is confirmed by at least one of:
 *   (a) this repository's previous production client, which ran against the
 *       company's real Billz account (see `docs/billz-api.md`), or
 *   (b) the published `billzio-api` wrapper for the Billz.io public v2 API.
 * Paths confirmed by both are marked as such.
 */
export const BILLZ_ENDPOINTS = {
  /** POST — exchanges the secret token for a bearer token. Confirmed by both. */
  login: '/v1/auth/login',
  /** GET — catalogue. Filters: page, limit, search, last_updated_date. Confirmed by both. */
  products: '/v2/products',
  /** GET — category tree. Filters: page, limit, search, is_deleted. */
  categories: '/v2/category',
  /** GET — brands. Filters: page, limit. */
  brands: '/v2/brand',
  /** GET — shops, which are Hadiya's branches. Filters: page, limit. */
  shops: '/v1/shop',
  /** GET — currencies configured for the company. */
  currencies: '/v2/company-currencies',
  /** GET — payment methods the company has enabled. Confirmed by both. */
  paymentTypes: '/v1/company-payment-type',
  /** GET (list) and POST (create) — customers, called "clients" by Billz. */
  clients: '/v1/client',
  /** PUT — update one customer. */
  client: (clientId: string): string => `/v1/client/${clientId}`,
  /**
   * GET — the receipt log: every order with its line items.
   * Filters: start_date, end_date, page, limit, shop_ids, company_payment_type_ids.
   */
  orderSearch: '/v3/order-search',
  /** GET — one order in full. */
  order: (orderId: string): string => `/v2/order/${orderId}`,
} as const;

/**
 * Endpoints that exist but that Hadiya does not call, with the reason. Kept
 * next to the ones we do use so the gap is visible rather than rediscovered.
 */
export const BILLZ_UNUSED_ENDPOINTS = {
  /** POST — order creation as a JSON-RPC style envelope over `/v1/orders`
   *  (`order.create`, `order.add_item`, `order.add_customer`, `order.make_payment`).
   *  Hadiya rings up its own sales; writing them into Billz as well would give
   *  one sale two records. Left unimplemented deliberately. */
  orders: '/v1/orders',
  /** GET — the general ledger, which is where Billz keeps expenses. Verified
   *  against the real account: it rejects the API secret token and accepts only
   *  an interactive user session, so it is not reachable with the credential
   *  this integration is designed around. */
  glTransaction: '/v1/gl-transaction',
  /** GET — answered 403 for this account's API key role. */
  salesReport: '/v2/sales-report',
  /** GET — answered 403 for this account's API key role. */
  cheque: '/v1/cheque',
} as const;
