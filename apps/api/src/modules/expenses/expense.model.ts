import {
  DEFAULT_CURRENCY,
  EXPENSE_CATEGORIES,
  EXPENSE_NOTE_MAX_LENGTH,
  EXPENSE_PAYMENT_METHODS,
  EXPENSE_VENDOR_MAX_LENGTH,
  type ExpenseCategory,
  type ExpensePaymentMethod,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One cost the shop bore.
 *
 * The only ledger Hadiya keeps for itself. Everything about the till comes from
 * Billz live; expenses do not, because Billz will not hand them over, so they
 * are recorded here by a person or by the assistant on a person's behalf.
 *
 * `date` is stored as a `YYYY-MM-DD` string rather than a `Date`. A cost
 * belongs to a calendar day in the shop's own zone, and that is also how the
 * sales figures are bucketed — so an expense and the same day's takings agree
 * on what "the 5th" is without a timezone conversion between them. A string
 * sorts and ranges correctly in that form, which is all the queries need.
 */
export interface ExpenseDocument {
  _id: Types.ObjectId;
  branch: Types.ObjectId | null;
  category: ExpenseCategory;
  /** Minor units, always positive. */
  amount: number;
  currency: string;
  /** `YYYY-MM-DD` in the shop's zone. */
  date: string;
  paymentMethod: ExpensePaymentMethod;
  vendor: string | null;
  note: string | null;
  createdBy: Types.ObjectId;
  conversation: Types.ObjectId | null;
  deletedAt: Date | null;
  deletedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = createSchema<ExpenseDocument>({
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', default: null },
  category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, required: true, default: DEFAULT_CURRENCY, maxlength: 3 },
  date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
  paymentMethod: { type: String, required: true, enum: EXPENSE_PAYMENT_METHODS },
  vendor: { type: String, default: null, trim: true, maxlength: EXPENSE_VENDOR_MAX_LENGTH },
  note: { type: String, default: null, trim: true, maxlength: EXPENSE_NOTE_MAX_LENGTH },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
  deletedAt: { type: Date, default: null },
  deletedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

// The question every screen and every tool asks: what did we spend over these
// days? Live rows first, then the day range, then the category the summary
// groups by.
expenseSchema.index({ deletedAt: 1, date: -1, category: 1 });
// Branch-bound staff read only their own branch's rows.
expenseSchema.index({ branch: 1, deletedAt: 1, date: -1 });

export const ExpenseModel: Model<ExpenseDocument> = model<ExpenseDocument>(
  'Expense',
  expenseSchema,
);
