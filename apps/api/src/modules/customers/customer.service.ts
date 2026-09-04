import type { AuthenticatedUser, PaginatedResult } from '@hadiya/shared';

import { toObjectIdOrNull } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import {
  assertBranchAccess,
  assertRole,
  canAccessAllBranches,
  requireActorBranch,
} from '../../core/security/actor.js';
import { branchRepository } from '../branches/branch.repository.js';
import { customerRepository } from './customer.repository.js';
import type { CustomerDocument } from './customer.model.js';
import type {
  CreateCustomerInput,
  ListCustomersQuery,
  UpdateCustomerInput,
} from './customer.validators.js';

/** Any signed-in employee can register a walk-in customer at the till. */
const CREATE_ROLE = 'cashier' as const;
/** Blocking a customer or moving them between branches is a manager's call. */
const MANAGE_ROLE = 'manager' as const;

const branchIdOf = (customer: CustomerDocument): string | null =>
  customer.branch ? String(customer.branch) : null;

const assertBranchExists = async (branchId: string): Promise<void> => {
  if (!(await branchRepository.isActive(branchId))) {
    throw ApiError.badRequest('The branch does not exist or is not active');
  }
};

export const createCustomer = async (
  actor: AuthenticatedUser,
  input: CreateCustomerInput,
): Promise<CustomerDocument> => {
  assertRole(actor, CREATE_ROLE);

  if (await customerRepository.phoneExists(input.phone)) {
    throw ApiError.conflict(`A customer with phone "${input.phone}" already exists`);
  }

  // Branch-bound staff register customers at their own branch; an
  // organisation-wide role may leave the customer unassigned.
  const branchId = canAccessAllBranches(actor)
    ? (input.branchId ?? null)
    : requireActorBranch(actor);

  if (branchId) {
    await assertBranchExists(branchId);
  }

  return customerRepository.create({
    fullName: input.fullName,
    phone: input.phone,
    notes: input.notes ?? null,
    status: 'active',
    branch: toObjectIdOrNull(branchId),
    debtBalance: 0,
  });
};

export const getCustomer = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<CustomerDocument> => {
  const customer = await customerRepository.findById(id);

  if (!customer) {
    throw ApiError.notFound('Customer not found');
  }

  // A customer with no branch is shared across the organisation.
  if (branchIdOf(customer)) {
    assertBranchAccess(actor, branchIdOf(customer));
  }

  return customer;
};

export const listCustomers = async (
  actor: AuthenticatedUser,
  query: ListCustomersQuery,
): Promise<PaginatedResult<CustomerDocument>> => {
  const filter: Record<string, unknown> = {};

  if (canAccessAllBranches(actor)) {
    if (query.branchId) {
      filter.branch = query.branchId;
    }
  } else {
    // Shared customers stay visible to branch staff alongside their own.
    filter.$or = [{ branch: requireActorBranch(actor) }, { branch: null }];
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.withDebt) {
    filter.debtBalance = { $gt: 0 };
  }

  if (query.search) {
    const search = { $regex: query.search, $options: 'i' };

    filter.$and = [{ $or: [{ fullName: search }, { phone: search }] }];
  }

  return customerRepository.list({ filter, pagination: query, sort: { fullName: 1 } });
};

export const updateCustomer = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateCustomerInput,
): Promise<CustomerDocument> => {
  const existing = await getCustomer(actor, id);

  if (input.status !== undefined || input.branchId !== undefined) {
    assertRole(actor, MANAGE_ROLE);
  }

  if (input.phone && (await customerRepository.phoneExists(input.phone, id))) {
    throw ApiError.conflict(`A customer with phone "${input.phone}" already exists`);
  }

  if (input.branchId) {
    await assertBranchExists(input.branchId);
  }

  const update: Record<string, unknown> = {};

  for (const field of ['fullName', 'phone', 'notes', 'status'] as const) {
    if (input[field] !== undefined) {
      update[field] = input[field];
    }
  }

  if (input.branchId !== undefined) {
    update.branch = toObjectIdOrNull(input.branchId);
  }

  const updated = await customerRepository.updateById(existing._id.toString(), update);

  if (!updated) {
    throw ApiError.notFound('Customer not found');
  }

  return updated;
};

/**
 * Blocking replaces deletion: the customer's sales and outstanding debt must
 * survive, and a blocked customer can no longer be attached to a new sale.
 */
export const blockCustomer = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<CustomerDocument> => updateCustomer(actor, id, { status: 'blocked' });
