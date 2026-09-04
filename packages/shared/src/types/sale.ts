import type { SalePaymentStatus, SaleStatus } from '../constants/sales.js';
import type { Entity, MinorUnits } from './entity.js';

/**
 * A line on a sale.
 *
 * `name`, `sku` and the prices are snapshots taken when the sale was made: a
 * receipt must keep showing what was actually charged even after the product is
 * renamed, repriced or deactivated. `product` still links to the live product,
 * so nothing else is duplicated.
 */
export interface SaleItem {
  /** Id of the product that was sold. */
  product: string;
  name: string;
  sku: string;
  unitPrice: MinorUnits;
  /** Cost at the time of sale, kept for margin reporting. */
  costPrice: MinorUnits;
  quantity: number;
  /** Absolute discount applied to the whole line, in minor units. */
  discount: MinorUnits;
  /** `unitPrice * quantity - discount`. */
  lineTotal: MinorUnits;
}

export interface SaleTotals {
  subtotal: MinorUnits;
  discountTotal: MinorUnits;
  grandTotal: MinorUnits;
  paidAmount: MinorUnits;
  /** `grandTotal - paidAmount`; becomes customer debt when positive. */
  dueAmount: MinorUnits;
}

export interface Sale extends Entity {
  /** Human-readable receipt number, unique per branch and day. */
  number: string;
  branch: string;
  /** Id of the employee who rang up the sale. */
  employee: string;
  /** `null` for an anonymous walk-in. */
  customer: string | null;
  items: SaleItem[];
  totals: SaleTotals;
  status: SaleStatus;
  paymentStatus: SalePaymentStatus;
  note: string | null;
  /** ISO-8601. */
  soldAt: string;
  /** ISO-8601, set when the sale was cancelled and stock returned. */
  cancelledAt: string | null;
}
