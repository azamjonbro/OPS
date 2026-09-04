import type { AuthenticatedUser, ExpenseStatus, PaginatedResult } from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import {
  assertBranchAccess,
  assertRole,
  canAccessAllBranches,
  requireActorBranch,
  resolveBranchForWrite,
} from '../../core/security/actor.js';
import { branchRepository } from '../branches/branch.repository.js';
import { expenseRepository } from './expense.repository.js';
import type { ExpenseDocument } from './expense.model.js';
import type {
  CreateExpenseInput,
  ListExpensesQuery,
  UpdateExpenseInput,
} from './expense.validators.js';

/** Any employee may submit a cost; approving one is a supervisor's decision. */
const SUBMIT_ROLE = 'employee' as const;
const REVIEW_ROLE = 'manager' as const;

/** Once money has moved, the record is history and stops being editable. */
const EDITABLE_STATUSES: ReadonlySet<ExpenseStatus> = new Set<ExpenseStatus>(['pending']);

export const createExpense = async (
  actor: AuthenticatedUser,
  input: CreateExpenseInput,
): Promise<ExpenseDocument> => {
  assertRole(actor, SUBMIT_ROLE);

  const branchId = resolveBranchForWrite(actor, input.branchId ?? null);

  if (!(await branchRepository.isActive(branchId))) {
    throw ApiError.badRequest('The branch does not exist or is not active');
  }

  return expenseRepository.create({
    branch: toObjectId(branchId),
    category: input.category,
    amount: input.amount,
    description: input.description ?? null,
    date: input.date ?? new Date(),
    status: 'pending',
    createdBy: toObjectId(actor.id),
    reviewedBy: null,
  });
};

export const getExpense = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ExpenseDocument> => {
  const expense = await expenseRepository.findById(id);

  if (!expense) {
    throw ApiError.notFound('Expense not found');
  }

  assertBranchAccess(actor, String(expense.branch));

  return expense;
};

export const listExpenses = async (
  actor: AuthenticatedUser,
  query: ListExpensesQuery,
): Promise<PaginatedResult<ExpenseDocument>> => {
  const filter: Record<string, unknown> = {};

  if (canAccessAllBranches(actor)) {
    if (query.branchId) {
      filter.branch = query.branchId;
    }
  } else {
    filter.branch = requireActorBranch(actor);
  }

  for (const [key, value] of [
    ['category', query.category],
    ['status', query.status],
    ['createdBy', query.createdById],
  ] as const) {
    if (value) {
      filter[key] = value;
    }
  }

  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  return expenseRepository.list({ filter, pagination: query, sort: { date: -1 } });
};

export const updateExpense = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateExpenseInput,
): Promise<ExpenseDocument> => {
  const existing = await getExpense(actor, id);

  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw ApiError.conflict(`An expense that is ${existing.status} can no longer be edited`);
  }

  // Staff may correct their own submission; a supervisor may correct anyone's.
  if (String(existing.createdBy) !== actor.id) {
    assertRole(actor, REVIEW_ROLE);
  }

  const updated = await expenseRepository.updateById(id, input);

  if (!updated) {
    throw ApiError.notFound('Expense not found');
  }

  return updated;
};

/**
 * Records the supervisor's decision. `reviewedBy` is stamped from the token, so
 * an approval always names a real person and cannot be attributed to someone
 * else by the client.
 */
export const reviewExpense = async (
  actor: AuthenticatedUser,
  id: string,
  status: Exclude<ExpenseStatus, 'pending'>,
): Promise<ExpenseDocument> => {
  assertRole(actor, REVIEW_ROLE);

  const existing = await getExpense(actor, id);

  if (existing.status === status) {
    throw ApiError.conflict(`This expense is already ${status}`);
  }

  if (existing.status === 'paid') {
    throw ApiError.conflict('A paid expense can no longer be reviewed');
  }

  if (status === 'paid' && existing.status !== 'approved') {
    throw ApiError.conflict('An expense must be approved before it is marked paid');
  }

  const updated = await expenseRepository.updateById(id, {
    status,
    reviewedBy: toObjectId(actor.id),
  });

  if (!updated) {
    throw ApiError.notFound('Expense not found');
  }

  return updated;
};

/** Only a pending submission can be withdrawn; anything reviewed is a record. */
export const deleteExpense = async (actor: AuthenticatedUser, id: string): Promise<void> => {
  const existing = await getExpense(actor, id);

  if (!EDITABLE_STATUSES.has(existing.status)) {
    throw ApiError.conflict(`An expense that is ${existing.status} cannot be deleted`);
  }

  if (String(existing.createdBy) !== actor.id) {
    assertRole(actor, REVIEW_ROLE);
  }

  await expenseRepository.deleteById(id);
};
