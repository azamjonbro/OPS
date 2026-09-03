import type { PaymentDirection, PaymentMethod, PaymentStatus } from '../constants/sales.js';
import type { Entity, MinorUnits } from './entity.js';

/**
 * Money moving between a customer and a branch. A payment is either tied to a
 * sale (settling that receipt) or stands alone (settling accumulated debt).
 */
export interface Payment extends Entity {
  branchId: string;
  saleId: string | null;
  customerId: string | null;
  amount: MinorUnits;
  method: PaymentMethod;
  direction: PaymentDirection;
  status: PaymentStatus;
  /** Card terminal slip, transfer id, or any external reference. */
  reference: string | null;
  /** Employee who took the payment. */
  receivedById: string;
  /** ISO-8601. */
  paidAt: string;
}
