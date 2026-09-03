import type { CustomerStatus } from '../constants/customers.js';
import type { Entity, MinorUnits } from './entity.js';

export interface Customer extends Entity {
  fullName: string;
  /** Primary identifier for a walk-in customer; unique. */
  phone: string;
  notes: string | null;
  status: CustomerStatus;
  /** Branch the customer is registered at, or `null` for organisation-wide. */
  branchId: string | null;
  /**
   * Outstanding debt in minor units: positive means the customer owes money.
   * Maintained only by the sale and payment services, never set directly.
   */
  debtBalance: MinorUnits;
}
