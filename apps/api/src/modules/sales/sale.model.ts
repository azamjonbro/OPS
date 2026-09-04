import {
  SALE_PAYMENT_STATUSES,
  SALE_STATUSES,
  type SalePaymentStatus,
  type SaleStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * A line on a sale.
 *
 * `name`, `sku` and the prices are snapshots taken at the moment of sale: a
 * receipt has to keep showing what was actually charged after the product is
 * renamed, repriced or retired. Nothing else about the product is copied —
 * `product` still points at the live record.
 */
export interface SaleItemSubdocument {
  product: Types.ObjectId;
  name: string;
  sku: string;
  unitPrice: number;
  costPrice: number;
  quantity: number;
  discount: number;
  lineTotal: number;
}

export interface SaleTotalsSubdocument {
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  paidAmount: number;
  dueAmount: number;
}

export interface SaleDocument {
  _id: Types.ObjectId;
  number: string;
  branch: Types.ObjectId;
  employee: Types.ObjectId;
  customer: Types.ObjectId | null;
  items: SaleItemSubdocument[];
  totals: SaleTotalsSubdocument;
  status: SaleStatus;
  paymentStatus: SalePaymentStatus;
  note: string | null;
  soldAt: Date;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const saleItemSchema = new Schema<SaleItemSubdocument>(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    sku: { type: String, required: true, trim: true, maxlength: 64 },
    unitPrice: { type: Number, required: true, min: 0 },
    costPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, default: 0 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const saleTotalsSchema = new Schema<SaleTotalsSubdocument>(
  {
    subtotal: { type: Number, required: true, min: 0 },
    discountTotal: { type: Number, required: true, min: 0, default: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, required: true, min: 0, default: 0 },
    dueAmount: { type: Number, required: true, min: 0, default: 0 },
  },
  { _id: false },
);

const saleSchema = createSchema<SaleDocument>({
  number: { type: String, required: true, trim: true, maxlength: 40 },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  employee: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  // Items are embedded rather than stored in their own collection: a sale is
  // always read, printed and cancelled as one unit, and a line has no life of
  // its own outside its receipt.
  items: { type: [saleItemSchema], required: true },
  totals: { type: saleTotalsSchema, required: true },
  status: { type: String, required: true, enum: SALE_STATUSES, default: 'completed' },
  paymentStatus: { type: String, required: true, enum: SALE_PAYMENT_STATUSES, default: 'unpaid' },
  note: { type: String, default: null, trim: true, maxlength: 1000 },
  soldAt: { type: Date, required: true },
  cancelledAt: { type: Date, default: null },
});

// Receipt numbers are unique organisation-wide; they are quoted by customers.
saleSchema.index({ number: 1 }, { unique: true });
// The daily sales list, and every report, reads one branch over a date range.
saleSchema.index({ branch: 1, soldAt: -1 });
// A customer's purchase history, newest first.
saleSchema.index({ customer: 1, soldAt: -1 });
// Finding what is still owed, per branch.
saleSchema.index({ branch: 1, paymentStatus: 1 });

export const SaleModel: Model<SaleDocument> = model<SaleDocument>('Sale', saleSchema);
