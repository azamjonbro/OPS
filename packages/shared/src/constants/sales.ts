export const SALE_STATUSES = ['completed', 'cancelled'] as const;

export type SaleStatus = (typeof SALE_STATUSES)[number];

/** Derived from what has been paid against the sale total; never set by hand. */
export const SALE_PAYMENT_STATUSES = ['unpaid', 'partial', 'paid'] as const;

export type SalePaymentStatus = (typeof SALE_PAYMENT_STATUSES)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ['completed', 'voided'] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Money in, or money returned to a customer. */
export const PAYMENT_DIRECTIONS = ['in', 'out'] as const;

export type PaymentDirection = (typeof PAYMENT_DIRECTIONS)[number];

export const resolveSalePaymentStatus = (
  grandTotal: number,
  paidAmount: number,
): SalePaymentStatus => {
  if (paidAmount <= 0) {
    return 'unpaid';
  }

  return paidAmount >= grandTotal ? 'paid' : 'partial';
};
