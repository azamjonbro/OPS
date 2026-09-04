import { CUSTOMER_STATUSES, type CustomerStatus } from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface CustomerDocument {
  _id: Types.ObjectId;
  fullName: string;
  phone: string;
  notes: string | null;
  status: CustomerStatus;
  branch: Types.ObjectId | null;
  /**
   * Outstanding debt in minor units; positive means the customer owes money.
   * Only the sale and payment services change it, and only inside the same
   * transaction as the document that caused the change.
   */
  debtBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

const customerSchema = createSchema<CustomerDocument>({
  fullName: { type: String, required: true, trim: true, maxlength: 160 },
  phone: { type: String, required: true, trim: true, maxlength: 32 },
  notes: { type: String, default: null, trim: true, maxlength: 2000 },
  status: { type: String, required: true, enum: CUSTOMER_STATUSES, default: 'active' },
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  debtBalance: { type: Number, required: true, default: 0 },
});

// The phone number is how a cashier finds a returning customer, and it is the
// one value that must not be duplicated across records.
customerSchema.index({ phone: 1 }, { unique: true });
// Branch managers list their own customers, usually the active ones.
customerSchema.index({ branch: 1, status: 1 });

export const CustomerModel: Model<CustomerDocument> = model<CustomerDocument>(
  'Customer',
  customerSchema,
);
