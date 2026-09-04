import type { PaymentDirection, PaymentMethod, PaymentStatus } from '../constants/sales.js';
import type { Entity, MinorUnits } from './entity.js';

/**
 * Money moving between a customer and a branch. A payment is either tied to a
 * sale (settling that receipt) or stands alone (settling accumulated debt).
 */
export interface Payment extends Entity {
  branch: string;
  /** Receipt this payment settles, when it is tied to one. */
  sale: string | null;
  customer: string | null;
  amount: MinorUnits;
  method: PaymentMethod;
  direction: PaymentDirection;
  status: PaymentStatus;
  /** Card terminal slip, transfer id, or any external reference. */
  reference: string | null;
  /** Id of the employee who took the payment. */
  receivedBy: string;
  /** ISO-8601. */
  paidAt: string;
}
