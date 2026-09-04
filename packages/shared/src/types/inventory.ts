import type { InventoryMovementType, MovementReferenceKind } from '../constants/inventory.js';
import type { Entity } from './entity.js';

/** On-hand stock for one product at one branch. */
export interface InventoryItem extends Entity {
  product: string;
  branch: string;
  quantity: number;
}

/**
 * One immutable stock change. `quantity` is signed (negative for a sale) and
 * `balanceAfter` is the resulting stock level, so history can be replayed and
 * audited without recomputing from the beginning.
 */
export interface InventoryMovement extends Entity {
  product: string;
  branch: string;
  type: InventoryMovementType;
  quantity: number;
  balanceAfter: number;
  reference: {
    kind: MovementReferenceKind;
    /** Id of the document that caused the movement, when there is one. */
    id: string | null;
  };
  note: string | null;
  /** Id of the employee who caused the movement. */
  createdBy: string;
  /** ISO-8601. */
  occurredAt: string;
}
