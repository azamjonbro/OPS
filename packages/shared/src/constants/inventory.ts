/**
 * Every way stock can move. Each movement is an immutable record; a stock level
 * is the running total of the movements that produced it, never an
 * independently edited number.
 *
 * A branch-to-branch transfer is written as a `transfer_out` on the source
 * branch and a `transfer_in` on the destination, so each record stays scoped to
 * exactly one branch.
 */
export const INVENTORY_MOVEMENT_TYPES = [
  'purchase',
  'sale',
  'return',
  'adjustment',
  'transfer_in',
  'transfer_out',
] as const;

export type InventoryMovementType = (typeof INVENTORY_MOVEMENT_TYPES)[number];

/** What a movement type does to the on-hand quantity. */
export const MOVEMENT_EFFECTS = {
  purchase: 'increase',
  sale: 'decrease',
  return: 'increase',
  adjustment: 'either',
  transfer_in: 'increase',
  transfer_out: 'decrease',
} as const satisfies Record<InventoryMovementType, 'increase' | 'decrease' | 'either'>;

export type MovementEffect = (typeof MOVEMENT_EFFECTS)[InventoryMovementType];

/**
 * Converts a positive magnitude into the signed delta a movement type applies.
 * `adjustment` is the only type that carries its own sign (stock counts can
 * correct in either direction).
 */
export const toSignedQuantity = (type: InventoryMovementType, quantity: number): number => {
  const effect = MOVEMENT_EFFECTS[type];

  if (effect === 'either') {
    return quantity;
  }

  return effect === 'increase' ? Math.abs(quantity) : -Math.abs(quantity);
};

/** What caused a movement, so it can be traced back to its origin document. */
export const MOVEMENT_REFERENCE_KINDS = ['sale', 'manual', 'transfer'] as const;

export type MovementReferenceKind = (typeof MOVEMENT_REFERENCE_KINDS)[number];
