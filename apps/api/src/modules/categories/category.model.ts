import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface CategoryDocument {
  _id: Types.ObjectId;
  name: string;
  description: string | null;
  parent: Types.ObjectId | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = createSchema<CategoryDocument>({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: null, trim: true, maxlength: 500 },
  parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
  isActive: { type: Boolean, required: true, default: true },
});

// Two categories may not share a name; the catalogue is browsed by name.
categorySchema.index({ name: 1 }, { unique: true });
// Listing the children of a category is the other common read.
categorySchema.index({ parent: 1 });

export const CategoryModel: Model<CategoryDocument> = model<CategoryDocument>(
  'Category',
  categorySchema,
);
