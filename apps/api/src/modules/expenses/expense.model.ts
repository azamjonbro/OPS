import {
  EXPENSE_CATEGORIES,
  EXPENSE_STATUSES,
  type ExpenseCategory,
  type ExpenseStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface ExpenseDocument {
  _id: Types.ObjectId;
  branch: Types.ObjectId;
  category: ExpenseCategory;
  /** Minor units, always positive. */
  amount: number;
  description: string | null;
  /** When the cost was incurred, which is not always when it was entered. */
  date: Date;
  status: ExpenseStatus;
  createdBy: Types.ObjectId;
  reviewedBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const expenseSchema = createSchema<ExpenseDocument>({
  branch: { type: Schema.Types.ObjectId, ref: 'Branch', required: true },
  category: { type: String, required: true, enum: EXPENSE_CATEGORIES },
  amount: { type: Number, required: true, min: 1 },
  description: { type: String, default: null, trim: true, maxlength: 1000 },
  date: { type: Date, required: true },
  status: { type: String, required: true, enum: EXPENSE_STATUSES, default: 'pending' },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
});

// Expenses are always read as "this branch, this period".
expenseSchema.index({ branch: 1, date: -1 });
// The approval queue: what is still waiting, per branch.
expenseSchema.index({ branch: 1, status: 1 });

export const ExpenseModel: Model<ExpenseDocument> = model<ExpenseDocument>(
  'Expense',
  expenseSchema,
);
