import {
  PAYMENT_DIRECTIONS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type PaymentDirection,
  type PaymentMethod,
  type PaymentStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * Money moving between a customer and a branch. A payment either settles a
 * specific receipt (`sale` set) or pays down accumulated debt (`customer` set);
 * both are set when a customer settles one of their own receipts later.
 */
export interface PaymentDocument {
  _id: Types.ObjectId;
  branch: Types.ObjectId;
  sale: Types.ObjectId | null;
  customer: Types.ObjectId | null;
  /** Minor units, always positive; `direction` carries the sign. */
  amount: number;
  method: PaymentMethod;
  direction: PaymentDirection;
  status: PaymentStatus;
  reference: string | null;
  receivedBy: Types.ObjectId;
  paidAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = createSchema<PaymentDocument>({
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  sale: { type: Schema.Types.ObjectId, ref: 'Sale', default: null },
  customer: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  amount: { type: Number, required: true, min: 1 },
  method: { type: String, required: true, enum: PAYMENT_METHODS },
  direction: { type: String, required: true, enum: PAYMENT_DIRECTIONS, default: 'in' },
  status: { type: String, required: true, enum: PAYMENT_STATUSES, default: 'completed' },
  reference: { type: String, default: null, trim: true, maxlength: 120 },
  receivedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  paidAt: { type: Date, required: true },
});

// Every payment taken against one receipt, which is how a sale's paid amount is
// audited and how cancelling a sale finds the payments to void.
paymentSchema.index({ sale: 1 });
// A customer's payment history, and the cash-up view for a branch and day.
paymentSchema.index({ customer: 1, paidAt: -1 });
paymentSchema.index({ branch: 1, paidAt: -1 });

export const PaymentModel: Model<PaymentDocument> = model<PaymentDocument>(
  'Payment',
  paymentSchema,
);
