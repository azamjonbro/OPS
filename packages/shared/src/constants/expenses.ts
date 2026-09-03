export const EXPENSE_CATEGORIES = [
  'rent',
  'salary',
  'utilities',
  'supplies',
  'transport',
  'marketing',
  'maintenance',
  'taxes',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** `paid` is terminal: a paid expense can no longer be edited or rejected. */
export const EXPENSE_STATUSES = ['pending', 'approved', 'rejected', 'paid'] as const;

export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
