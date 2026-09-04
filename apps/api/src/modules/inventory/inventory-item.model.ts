import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * On-hand stock for one product at one branch.
 *
 * This is a running total derived from `InventoryMovement` records, kept as its
 * own document so a till can read a stock level in one query instead of summing
 * the whole movement history.
 */
export interface InventoryItemDocument {
  _id: Types.ObjectId;
  product: Types.ObjectId;
  branch: Types.ObjectId;
  quantity: number;
  createdAt: Date;
  updatedAt: Date;
}

const inventoryItemSchema = createSchema<InventoryItemDocument>({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  quantity: { type: Number, required: true, default: 0 },
});

// One stock row per product per branch. The unique constraint is what makes the
// upsert in `recordMovement` safe under concurrency.
inventoryItemSchema.index({ product: 1, branch: 1 }, { unique: true });
// Stock lists are read per branch, often filtered to what is running low.
inventoryItemSchema.index({ branch: 1, quantity: 1 });

export const InventoryItemModel: Model<InventoryItemDocument> = model<InventoryItemDocument>(
  'InventoryItem',
  inventoryItemSchema,
);
