import { toMinorUnits } from '@hadiya/shared';

import type {
  BillzRawBrand,
  BillzRawCategory,
  BillzRawClient,
  BillzRawCurrency,
  BillzRawOrder,
  BillzRawOrderItem,
  BillzRawOrderPayment,
  BillzRawPaymentType,
  BillzRawProduct,
  BillzRawShop,
} from './client/billz-raw.types.js';
import type {
  BillzBrand,
  BillzCategory,
  BillzCurrency,
  BillzCustomer,
  BillzPaymentType,
  BillzProduct,
  BillzSale,
  BillzSaleItem,
  BillzSalePayment,
  BillzShop,
  BillzShopPriceView,
  BillzStockLevel,
} from './billz.types.js';

/**
 * Raw Billz payloads to Hadiya's shapes.
 *
 * Two rules run through all of it. Money arrives from Billz as a major-unit
 * number (so'm) and is stored here as integer minor units, the way Hadiya
 * handles money everywhere. And a field Billz omits becomes `null`, never an
 * invented zero or an empty string that would read as real data.
 */
const DEFAULT_CURRENCY = 'UZS';

const text = (value: string | undefined | null): string | null => {
  const trimmed = value?.trim();

  return trimmed && trimmed.length > 0 ? trimmed : null;
};

/** Billz quotes money in so'm; Hadiya keeps integer tiyin. */
const money = (value: number | undefined | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? toMinorUnits(value) : 0;

const quantity = (value: number | undefined | null): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const mapShopPrice = (
  price: BillzRawProduct['shop_prices'] extends (infer T)[] | undefined ? T : never,
): BillzShopPriceView => ({
  shopId: price.shop_id ?? '',
  shopName: price.shop_name ?? '',
  retailPrice: money(price.retail_price),
  supplyPrice: money(price.supply_price),
  currency: text(price.retail_currency) ?? DEFAULT_CURRENCY,
});

const mapStock = (
  stock: BillzRawProduct['shop_measurement_values'] extends (infer T)[] | undefined ? T : never,
): BillzStockLevel => ({
  shopId: stock.shop_id ?? '',
  shopName: stock.shop_name ?? '',
  quantity: quantity(stock.active_measurement_value),
});

/**
 * Keeps only the shops this integration is scoped to. An empty scope means the
 * whole company, which is what a single-shop account wants.
 */
const withinScope = <TEntry extends { shopId: string }>(
  entries: TEntry[],
  shopIds: string[],
): TEntry[] =>
  shopIds.length === 0 ? entries : entries.filter((entry) => shopIds.includes(entry.shopId));

export const mapProduct = (raw: BillzRawProduct, shopIds: string[] = []): BillzProduct => {
  const prices = withinScope((raw.shop_prices ?? []).map(mapShopPrice), shopIds);
  const stock = withinScope((raw.shop_measurement_values ?? []).map(mapStock), shopIds);
  const headline = prices[0];
  const category = raw.categories?.[0];

  return {
    externalId: raw.id ?? '',
    name: text(raw.name) ?? 'Unnamed product',
    sku: text(raw.sku) ?? '',
    barcode: text(raw.barcode),
    description: text(raw.description),
    brand: text(raw.brand_name),
    categoryName: text(category?.name),
    categoryExternalId: text(category?.id),
    unit: text(raw.measurement_unit?.short_name) ?? text(raw.measurement_unit?.name),
    imageUrl: text(raw.main_image_url_full) ?? text(raw.photos?.[0]?.photo_url),
    retailPrice: headline?.retailPrice ?? 0,
    supplyPrice: headline?.supplyPrice ?? 0,
    currency: headline?.currency ?? DEFAULT_CURRENCY,
    prices,
    stock,
    totalStock: stock.reduce((total, entry) => total + entry.quantity, 0),
    updatedAt: text(raw.updated_at),
  };
};

export const mapCategory = (raw: BillzRawCategory): BillzCategory => ({
  externalId: raw.id ?? '',
  name: text(raw.name) ?? 'Unnamed category',
  parentExternalId: text(raw.parent_id),
  productCount: raw.product_count ?? 0,
});

export const mapBrand = (raw: BillzRawBrand): BillzBrand => ({
  externalId: raw.id ?? '',
  name: text(raw.name) ?? 'Unnamed brand',
});

export const mapShop = (raw: BillzRawShop): BillzShop => ({
  externalId: raw.id ?? '',
  name: text(raw.name) ?? 'Unnamed shop',
  address: text(raw.address),
  phone: text(raw.phone_numbers?.[0]),
  legalName: text(raw.legal_name),
  taxNumber: text(raw.inn),
});

export const mapCurrency = (raw: BillzRawCurrency): BillzCurrency => ({
  externalId: raw.id ?? '',
  name: text(raw.name) ?? 'Unnamed currency',
  code: text(raw.code),
  rate: typeof raw.rate === 'number' ? raw.rate : null,
});

export const mapPaymentType = (raw: BillzRawPaymentType): BillzPaymentType => ({
  externalId: raw.id ?? '',
  name: text(raw.name) ?? text(raw.payment_type?.name) ?? 'Unnamed payment type',
  isCash: raw.is_cash_payment_type === true,
});

export const mapCustomer = (raw: BillzRawClient): BillzCustomer => {
  const fullName = [text(raw.first_name), text(raw.last_name)].filter(Boolean).join(' ');

  return {
    externalId: raw.id ?? '',
    fullName: fullName.length > 0 ? fullName : 'Unnamed customer',
    phone: text(raw.phone_number),
    gender: text(raw.gender),
    dateOfBirth: text(raw.date_of_birth),
    createdAt: text(raw.created_at),
  };
};

const mapSaleItem = (raw: BillzRawOrderItem): BillzSaleItem => {
  // A return leaves `measurement_value` at zero and reports the units in
  // `returned_measurement_value` instead.
  const units = quantity(raw.measurement_value) || quantity(raw.returned_measurement_value);
  const unitPrice = money(raw.sale_price ?? raw.price);

  return {
    productExternalId: text(raw.product?.id),
    name: text(raw.product?.name) ?? text(raw.product?.base_name) ?? 'Unnamed product',
    sku: text(raw.product?.sku),
    barcode: text(raw.product?.barcode),
    quantity: units,
    unit: text(raw.product?.measurement_unit?.short_name),
    unitPrice,
    discount: money(raw.discount_amount),
    lineTotal: raw.total_price === undefined ? unitPrice * units : money(raw.total_price),
    isReturned: raw.is_returned === true,
  };
};

/**
 * What one method covered on a receipt.
 *
 * Billz does record this per method — `paid_amount` against a
 * `company_payment_type` — so a receipt settled with cash *and* card can be
 * split exactly rather than reported as an unsplittable lump.
 */
const mapSalePayment = (raw: BillzRawOrderPayment): BillzSalePayment => ({
  paymentTypeExternalId:
    text(raw.company_payment_type_id) ?? text(raw.company_payment_type?.id) ?? '',
  paymentTypeName: text(raw.company_payment_type?.name),
  paidAmount: money(raw.paid_amount),
  returnedAmount: money(raw.returned_amount),
});

/**
 * One receipt.
 *
 * Nearly every field is read from `order_detail` rather than from the envelope
 * around it. That is where `/v3/order-search` actually puts them, and reading
 * the envelope instead does not fail — it yields `undefined`, which becomes a
 * zero, so a day of real trade reports as no money at all rather than as an
 * error somebody would notice.
 */
export const mapSale = (raw: BillzRawOrder): BillzSale => {
  const detail = raw.order_detail;
  const customer = detail?.customer;
  const customerName = [text(customer?.first_name), text(customer?.last_name)]
    .filter(Boolean)
    .join(' ');

  return {
    externalId: raw.id ?? '',
    type: raw.order_type?.toUpperCase() === 'RETURN' ? 'return' : 'sale',
    parentExternalId: text(raw.parent_id),
    shopExternalId: text(detail?.shop_id) ?? text(detail?.shop?.id),
    shopName: text(detail?.shop?.name),
    customerExternalId: text(raw.customer_id) ?? text(customer?.id),
    customerName: customerName.length > 0 ? customerName : null,
    total: money(detail?.total_price),
    debtAmount: raw.debt?.amount === undefined ? null : money(raw.debt.amount),
    items: (detail?.order_items ?? []).map(mapSaleItem),
    payments: (detail?.order_payments ?? []).map(mapSalePayment),
    // `sold_at` is when the till finished the sale; `created_at` is when the
    // basket was opened, which can be a different day for a receipt left open
    // over midnight.
    soldAt: text(raw.sold_at) ?? text(raw.finished_at) ?? text(raw.created_at),
  };
};
