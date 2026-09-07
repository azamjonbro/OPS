import { searchRegexFilter, type AuthenticatedUser, type PaginatedResult } from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';
import { assertRole, canAccessAllBranches, requireActorBranch } from '../../core/security/actor.js';
import { branchRepository } from './branch.repository.js';
import type { BranchDocument } from './branch.model.js';
import type {
  CreateBranchInput,
  ListBranchesQuery,
  UpdateBranchInput,
} from './branch.validators.js';

/**
 * Branches are organisation-level records: only an admin or the owner may
 * create or change one. Everyone else can read the branch they work at, which
 * the UI needs for pickers and receipts.
 */
const MANAGE_ROLE = 'admin' as const;

const assertVisible = (actor: AuthenticatedUser, branch: BranchDocument): void => {
  if (canAccessAllBranches(actor)) {
    return;
  }

  if (String(branch._id) !== actor.branchId) {
    throw ApiError.forbidden('This record belongs to another branch');
  }
};

export const createBranch = async (
  actor: AuthenticatedUser,
  input: CreateBranchInput,
): Promise<BranchDocument> => {
  assertRole(actor, MANAGE_ROLE);

  if (await branchRepository.codeExists(input.code)) {
    throw ApiError.conflict(`Branch code "${input.code}" is already in use`);
  }

  return branchRepository.create({
    name: input.name,
    code: input.code,
    address: input.address ?? null,
    phone: input.phone ?? null,
    isActive: true,
  });
};

export const getBranch = async (actor: AuthenticatedUser, id: string): Promise<BranchDocument> => {
  const branch = await branchRepository.findById(id);

  if (!branch) {
    throw ApiError.notFound('Branch not found');
  }

  assertVisible(actor, branch);

  return branch;
};

export const listBranches = async (
  actor: AuthenticatedUser,
  query: ListBranchesQuery,
): Promise<PaginatedResult<BranchDocument>> => {
  const filter: Record<string, unknown> = {};

  // Branch-bound staff only ever see their own branch, whatever they ask for.
  if (!canAccessAllBranches(actor)) {
    filter._id = requireActorBranch(actor);
  }

  if (query.isActive !== undefined) {
    filter.isActive = query.isActive;
  }

  const search = searchRegexFilter(query.search);

  if (search) {
    filter.$or = [{ name: search }, { code: search }];
  }

  return branchRepository.list({
    filter,
    pagination: query,
    sort: { name: 1 },
  });
};

export const updateBranch = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateBranchInput,
): Promise<BranchDocument> => {
  assertRole(actor, MANAGE_ROLE);

  const existing = await branchRepository.findById(id);

  if (!existing) {
    throw ApiError.notFound('Branch not found');
  }

  if (input.code && (await branchRepository.codeExists(input.code, id))) {
    throw ApiError.conflict(`Branch code "${input.code}" is already in use`);
  }

  const updated = await branchRepository.updateById(id, input);

  if (!updated) {
    throw ApiError.notFound('Branch not found');
  }

  return updated;
};

/**
 * Branches are never deleted: sales, stock and expenses reference them for as
 * long as those records are kept. Closing one deactivates it instead.
 */
export const deactivateBranch = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<BranchDocument> => updateBranch(actor, id, { isActive: false });
