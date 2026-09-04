import {
  EXTERNAL_SOURCES,
  PRODUCT_UNITS,
  type ExternalSource,
  type ProductUnit,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface ProductImageSubdocument {
  url: string;
  alt: string | null;
  isPrimary: boolean;
  sortOrder: number;
}

export interface ProductExternalRefSubdocument {
  source: ExternalSource;
  externalId: string;
  syncedAt: Date | null;
}

export interface ProductDocument {
  _id: Types.ObjectId;
  name: string;
  sku: string;
  barcode: string | null;
  description: string | null;
  category: Types.ObjectId;
  /** Minor units (tiyin). Integers only — never a floating-point amount. */
  price: number;
  costPrice: number;
  currency: string;
  unit: ProductUnit;
  trackInventory: boolean;
  reorderLevel: number;
  isActive: boolean;
  images: ProductImageSubdocument[];
  externalRefs: ProductExternalRefSubdocument[];
  createdAt: Date;
  updatedAt: Date;
}

const imageSchema = new Schema<ProductImageSubdocument>(
  {
    url: { type: String, required: true, trim: true, maxlength: 2048 },
    alt: { type: String, default: null, trim: true, maxlength: 240 },
    isPrimary: { type: Boolean, required: true, default: false },
    sortOrder: { type: Number, required: true, default: 0, min: 0 },
  },
  { _id: false },
);

/**
 * Mapping to a record in an external system. Stored as a list so a product can
 * carry references for several integrations, and so a future Billz sync can
 * match on an explicit id rather than guessing from the name or SKU.
 */
const externalRefSchema = new Schema<ProductExternalRefSubdocument>(
  {
    source: { type: String, required: true, enum: EXTERNAL_SOURCES },
    externalId: { type: String, required: true, trim: true, maxlength: 120 },
    syncedAt: { type: Date, default: null },
  },
  { _id: false },
);

const productSchema = createSchema<ProductDocument>({
  name: { type: String, required: true, trim: true, maxlength: 200 },
  sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 64 },
  barcode: { type: String, default: null, trim: true, maxlength: 64 },
  description: { type: String, default: null, trim: true, maxlength: 2000 },
  category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
  price: { type: Number, required: true, min: 0 },
  costPrice: { type: Number, required: true, min: 0, default: 0 },
  currency: { type: String, required: true, uppercase: true, minlength: 3, maxlength: 3 },
  unit: { type: String, required: true, enum: PRODUCT_UNITS, default: 'piece' },
  trackInventory: { type: Boolean, required: true, default: true },
  reorderLevel: { type: Number, required: true, min: 0, default: 0 },
  isActive: { type: Boolean, required: true, default: true },
  images: { type: [imageSchema], default: [] },
  externalRefs: { type: [externalRefSchema], default: [] },
});

// The two identifiers a POS looks a product up by, thousands of times a day.
productSchema.index({ sku: 1 }, { unique: true });
// Partial, not sparse: a product without a barcode stores an explicit `null`,
// and a sparse index still indexes nulls — which would let only one product in
// the whole catalogue go without a barcode. The partial filter indexes only the
// documents that actually have one.
productSchema.index(
  { barcode: 1 },
  { unique: true, partialFilterExpression: { barcode: { $type: 'string' } } },
);
// Catalogue browsing is always "active products in this category".
productSchema.index({ category: 1, isActive: 1 });
// An external id maps to at most one product, which is what makes a sync safe
// to re-run: the same Billz record can never fan out into duplicates.
productSchema.index(
  { 'externalRefs.source': 1, 'externalRefs.externalId': 1 },
  { unique: true, sparse: true },
);

export const ProductModel: Model<ProductDocument> = model<ProductDocument>(
  'Product',
  productSchema,
);
