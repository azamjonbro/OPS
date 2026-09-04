import type { ExpenseCategory, ExpenseStatus } from '../constants/expenses.js';
import type { Entity, MinorUnits } from './entity.js';

export interface Expense extends Entity {
  branch: string;
  category: ExpenseCategory;
  amount: MinorUnits;
  description: string | null;
  /** ISO-8601 date the cost was incurred, which is not always when it was entered. */
  date: string;
  status: ExpenseStatus;
  createdBy: string;
  /** Id of the employee who approved or rejected it, when that has happened. */
  reviewedBy: string | null;
}
