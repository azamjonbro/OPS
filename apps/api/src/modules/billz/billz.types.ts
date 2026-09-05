/**
 * Hadiya's own view of Billz data.
 *
 * Nothing outside this module — no controller, no sync job, no future AI tool —
 * sees a Billz field name. Money is converted to integer minor units on the way
 * in, matching how Hadiya stores money everywhere else.
 */
import type { MinorUnits } from '@hadiya/shared';

export interface BillzStockLevel {
  shopId: string;
  shopName: string;
  quantity: number;
}

export interface BillzShopPriceView {
  shopId: string;
  shopName: string;
  retailPrice: MinorUnits;
  supplyPrice: MinorUnits;
  currency: string;
}

export interface BillzProduct {
  /** Billz's id. Never a Hadiya `_id`. */
  externalId: string;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  brand: string | null;
  categoryName: string | null;
  categoryExternalId: string | null;
  unit: string | null;
  imageUrl: string | null;
  /** Price at the first configured shop, for a single headline figure. */
  retailPrice: MinorUnits;
  supplyPrice: MinorUnits;
  currency: string;
  prices: BillzShopPriceView[];
  stock: BillzStockLevel[];
  /** Sum of `stock`, so callers do not have to add it up. */
  totalStock: number;
  /** ISO-8601; the cursor incremental sync follows. */
  updatedAt: string | null;
}

export interface BillzCategory {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  productCount: number;
}

export interface BillzBrand {
  externalId: string;
  name: string;
}

export interface BillzShop {
  externalId: string;
  name: string;
  address: string | null;
  phone: string | null;
  legalName: string | null;
  taxNumber: string | null;
}

export interface BillzCurrency {
  externalId: string;
  name: string;
  code: string | null;
  rate: number | null;
}

export interface BillzPaymentType {
  externalId: string;
  name: string;
  isCash: boolean;
}

export interface BillzCustomer {
  externalId: string;
  fullName: string;
  phone: string | null;
  gender: string | null;
  dateOfBirth: string | null;
  createdAt: string | null;
}

export interface BillzSaleItem {
  productExternalId: string | null;
  name: string;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  unit: string | null;
  unitPrice: MinorUnits;
  discount: MinorUnits;
  lineTotal: MinorUnits;
  isReturned: boolean;
}

/** What one payment method covered on a receipt. */
export interface BillzSalePayment {
  paymentTypeExternalId: string;
  paymentTypeName: string | null;
  paidAmount: MinorUnits;
  returnedAmount: MinorUnits;
}

export interface BillzSale {
  externalId: string;
  /** `sale` or `return`; a return points back at the sale it reverses. */
  type: 'sale' | 'return';
  parentExternalId: string | null;
  shopExternalId: string | null;
  shopName: string | null;
  customerExternalId: string | null;
  customerName: string | null;
  total: MinorUnits;
  /** Present when the receipt was left on credit. */
  debtAmount: MinorUnits | null;
  items: BillzSaleItem[];
  /** How it was settled, per method. Empty when the receipt went on credit. */
  payments: BillzSalePayment[];
  soldAt: string | null;
}

export interface BillzInventoryLevel {
  productExternalId: string;
  productName: string;
  sku: string;
  shopId: string;
  shopName: string;
  quantity: number;
  retailPrice: MinorUnits;
  /** `quantity * retailPrice`, so a caller can total a shelf directly. */
  stockValue: MinorUnits;
}

export interface BillzConnectionStatus {
  configured: boolean;
  connected: boolean;
  baseUrl: string;
  /** Populated only when the probe failed. */
  error: string | null;
  checkedAt: string;
}
