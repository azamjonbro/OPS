import {
  INVENTORY_MOVEMENT_TYPES,
  MOVEMENT_REFERENCE_KINDS,
  type InventoryMovementType,
  type MovementReferenceKind,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One immutable stock change. Movements are only ever appended: correcting a
 * mistake means recording an `adjustment`, never editing history.
 */
export interface InventoryMovementDocument {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  branch: Types.ObjectId;
  type: InventoryMovementType;
  /** Signed: negative for a sale or transfer out. */
  quantity: number;
  /** Stock level after this movement was applied. */
  balanceAfter: number;
  reference: {
    kind: MovementReferenceKind;
    id: Types.ObjectId | null;
  };
  note: string | null;
  createdBy: Types.ObjectId;
  occurredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const referenceSchema = new Schema<InventoryMovementDocument['reference']>(
  {
    kind: { type: String, required: true, enum: MOVEMENT_REFERENCE_KINDS },
    id: { type: Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const inventoryMovementSchema = createSchema<InventoryMovementDocument>({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  type: { type: String, required: true, enum: INVENTORY_MOVEMENT_TYPES },
  quantity: { type: Number, required: true },
  balanceAfter: { type: Number, required: true },
  reference: { type: referenceSchema, required: true },
  note: { type: String, default: null, trim: true, maxlength: 500 },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  occurredAt: { type: Date, required: true },
});

// The stock card for one product at one branch, newest first.
inventoryMovementSchema.index({ product: 1, branch: 1, occurredAt: -1 });
// Branch-wide movement history for a date range, which is what audits ask for.
inventoryMovementSchema.index({ branch: 1, occurredAt: -1 });
// Tracing every movement a sale caused, e.g. when it is cancelled.
inventoryMovementSchema.index({ 'reference.kind': 1, 'reference.id': 1 });

export const InventoryMovementModel: Model<InventoryMovementDocument> =
  model<InventoryMovementDocument>('InventoryMovement', inventoryMovementSchema);
