/**
 * The shapes Billz actually returns, in its own snake_case vocabulary.
 *
 * These types stop at the module boundary: everything Hadiya exposes is the
 * normalised form in `../billz.types.ts`. Fields are optional wherever the real
 * payloads have been seen to omit them, so a missing field is a mapping
 * decision rather than a crash.
 */

export interface BillzAuthResponse {
  data?: {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    /** Seconds. */
    expires_in?: number;
  };
}

export interface BillzShopPrice {
  shop_id?: string;
  shop_name?: string;
  retail_price?: number;
  retail_currency?: string;
  supply_price?: number;
}

export interface BillzShopMeasurementValue {
  shop_id?: string;
  shop_name?: string;
  /** Units currently on the shelf at that shop. */
  active_measurement_value?: number;
}

export interface BillzProductCategory {
  id?: string;
  name?: string;
}

export interface BillzMeasurementUnit {
  name?: string;
  short_name?: string;
}

export interface BillzProductPhoto {
  photo_url?: string;
}

export interface BillzRawProduct {
  id?: string;
  name?: string;
  sku?: string;
  barcode?: string;
  description?: string;
  brand_id?: string;
  brand_name?: string;
  parent_id?: string;
  is_variative?: boolean;
  main_image_url_full?: string;
  main_image_url?: string;
  photos?: BillzProductPhoto[];
  categories?: BillzProductCategory[];
  measurement_unit?: BillzMeasurementUnit;
  shop_prices?: BillzShopPrice[];
  shop_measurement_values?: BillzShopMeasurementValue[];
  updated_at?: string;
}

export interface BillzProductsResponse {
  products?: BillzRawProduct[];
  count?: number;
}

export interface BillzRawCategory {
  id?: string;
  name?: string;
  parent_id?: string;
  product_count?: number;
  level_number?: number;
}

export interface BillzCategoriesResponse {
  categories?: BillzRawCategory[];
  count?: number;
}

export interface BillzRawBrand {
  id?: string;
  name?: string;
}

export interface BillzBrandsResponse {
  brands?: BillzRawBrand[];
  count?: number;
}

export interface BillzRawShop {
  id?: string;
  company_id?: string;
  name?: string;
  address?: string;
  phone_numbers?: string[];
  legal_name?: string;
  inn?: string;
}

export interface BillzShopsResponse {
  shops?: BillzRawShop[];
  count?: number;
}

export interface BillzRawCurrency {
  id?: string;
  name?: string;
  code?: string;
  rate?: number;
}

export interface BillzCurrenciesResponse {
  company_currencies?: BillzRawCurrency[];
  currencies?: BillzRawCurrency[];
  count?: number;
}

export interface BillzRawPaymentType {
  id?: string;
  company_id?: string;
  name?: string;
  is_cash_payment_type?: boolean;
  payment_type?: { id?: string; name?: string };
}

export interface BillzPaymentTypesResponse {
  company_payment_types?: BillzRawPaymentType[];
  count?: number;
}

export interface BillzRawClient {
  id?: string;
  first_name?: string;
  last_name?: string;
  phone_number?: string;
  gender?: string;
  date_of_birth?: string;
  chat_id?: string;
  created_at?: string;
}

export interface BillzClientsResponse {
  clients?: BillzRawClient[];
  count?: number;
}

export interface BillzRawOrderItem {
  product?: {
    id?: string;
    name?: string;
    base_name?: string;
    sku?: string;
    barcode?: string;
    measurement_unit?: BillzMeasurementUnit;
  };
  /** Units sold. A return leaves this at 0 and fills `returned_measurement_value`. */
  measurement_value?: number;
  returned_measurement_value?: number;
  sale_price?: number;
  price?: number;
  total_price?: number;
  discount_amount?: number;
  is_returned?: boolean;
}

export interface BillzRawOrder {
  id?: string;
  /** `SALE` or `RETURN`; a return carries a negative total and a `parent_id`. */
  order_type?: string;
  total_price?: number;
  parent_id?: string;
  shop_id?: string;
  shop_name?: string;
  customer_id?: string;
  customer?: { id?: string; first_name?: string; last_name?: string; phone_number?: string };
  created_at?: string;
  finished_date?: string;
  is_deleted?: boolean;
  debt?: { amount?: number } | null;
  order_detail?: { order_items?: BillzRawOrderItem[] };
}

/**
 * Order search groups its results by day, so the orders live one level deeper
 * than in every other list response.
 */
export interface BillzOrderSearchResponse {
  orders_sorted_by_date_list?: Array<{ date?: string; orders?: BillzRawOrder[] }>;
  count?: number;
}

export interface BillzOrderResponse {
  order?: BillzRawOrder;
  data?: BillzRawOrder;
}
