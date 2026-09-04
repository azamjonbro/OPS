import {
  hasAtLeastRole,
  type AuthenticatedUser,
  type PaginatedResult,
  type UserRole,
} from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';
import { toObjectIdOrNull } from '../../core/db/object-id.js';
import { hashPassword, verifyPassword } from '../../core/security/password.js';
import { assertRole, canAccessAllBranches, requireActorBranch } from '../../core/security/actor.js';
import { branchRepository } from '../branches/branch.repository.js';
import { userRepository } from './user.repository.js';
import type { UserDocument } from './user.model.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './user.validators.js';

/** Managing staff accounts is an administrative action. */
const MANAGE_ROLE: UserRole = 'admin';
/** Roles below this one must belong to exactly one branch. */
const BRANCH_BOUND_BELOW: UserRole = 'admin';

const requiresBranch = (role: UserRole): boolean => !hasAtLeastRole(role, BRANCH_BOUND_BELOW);

/**
 * Nobody may create or promote an account to a role above their own — otherwise
 * an admin could mint an owner and escalate sideways.
 */
const assertMayAssignRole = (actor: AuthenticatedUser, role: UserRole): void => {
  if (!hasAtLeastRole(actor.role, role)) {
    throw ApiError.forbidden('You cannot assign a role higher than your own');
  }
};

const assertBranchExists = async (branchId: string): Promise<void> => {
  if (!(await branchRepository.isActive(branchId))) {
    throw ApiError.badRequest('The branch does not exist or is not active');
  }
};

const assertVisible = (actor: AuthenticatedUser, user: UserDocument): void => {
  if (canAccessAllBranches(actor) || String(user._id) === actor.id) {
    return;
  }

  if (!user.branch || String(user.branch) !== actor.branchId) {
    throw ApiError.forbidden('This employee belongs to another branch');
  }
};

export const createUser = async (
  actor: AuthenticatedUser,
  input: CreateUserInput,
): Promise<UserDocument> => {
  assertRole(actor, MANAGE_ROLE);
  assertMayAssignRole(actor, input.role);

  if (await userRepository.usernameExists(input.username)) {
    throw ApiError.conflict(`Username "${input.username}" is already taken`);
  }

  const branchId =
    input.branchId ?? (canAccessAllBranches(actor) ? null : requireActorBranch(actor));

  if (requiresBranch(input.role) && !branchId) {
    throw ApiError.badRequest(`A ${input.role} account must be assigned to a branch`);
  }

  if (branchId) {
    await assertBranchExists(branchId);
  }

  const created = await userRepository.create({
    username: input.username,
    passwordHash: await hashPassword(input.password),
    fullName: input.fullName,
    role: input.role,
    status: 'active',
    phone: input.phone ?? null,
    branch: toObjectIdOrNull(branchId),
    lastLoginAt: null,
  });

  return stripSecret(created);
};

export const getUser = async (actor: AuthenticatedUser, id: string): Promise<UserDocument> => {
  const user = await userRepository.findById(id);

  if (!user) {
    throw ApiError.notFound('Employee not found');
  }

  assertVisible(actor, user);

  return user;
};

export const listUsers = async (
  actor: AuthenticatedUser,
  query: ListUsersQuery,
): Promise<PaginatedResult<UserDocument>> => {
  assertRole(actor, 'manager');

  const filter: Record<string, unknown> = {};

  if (canAccessAllBranches(actor)) {
    if (query.branchId) {
      filter.branch = query.branchId;
    }
  } else {
    filter.branch = requireActorBranch(actor);
  }

  if (query.role) {
    filter.role = query.role;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.search) {
    filter.$or = [
      { username: { $regex: query.search, $options: 'i' } },
      { fullName: { $regex: query.search, $options: 'i' } },
    ];
  }

  return userRepository.list({ filter, pagination: query, sort: { fullName: 1 } });
};

export const updateUser = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateUserInput,
): Promise<UserDocument> => {
  assertRole(actor, MANAGE_ROLE);

  const existing = await userRepository.findById(id);

  if (!existing) {
    throw ApiError.notFound('Employee not found');
  }

  assertVisible(actor, existing);
  // Changing an account at or above your own level is not yours to do.
  assertMayAssignRole(actor, existing.role);

  const nextRole = input.role ?? existing.role;

  if (input.role) {
    assertMayAssignRole(actor, input.role);
  }

  const update: Record<string, unknown> = {};

  if (input.fullName !== undefined) {
    update.fullName = input.fullName;
  }

  if (input.phone !== undefined) {
    update.phone = input.phone;
  }

  if (input.role !== undefined) {
    update.role = input.role;
  }

  if (input.branchId !== undefined) {
    if (input.branchId) {
      await assertBranchExists(input.branchId);
    }

    update.branch = toObjectIdOrNull(input.branchId);
  }

  const nextBranch =
    input.branchId !== undefined
      ? input.branchId
      : existing.branch
        ? String(existing.branch)
        : null;

  if (requiresBranch(nextRole) && !nextBranch) {
    throw ApiError.badRequest(`A ${nextRole} account must be assigned to a branch`);
  }

  const updated = await userRepository.updateById(id, update);

  if (!updated) {
    throw ApiError.notFound('Employee not found');
  }

  return updated;
};

/**
 * Suspension is how an account is retired: sales, movements and expenses keep
 * pointing at the employee who made them, so the record is never deleted.
 */
export const setUserStatus = async (
  actor: AuthenticatedUser,
  id: string,
  status: UserDocument['status'],
): Promise<UserDocument> => {
  assertRole(actor, MANAGE_ROLE);

  if (id === actor.id) {
    throw ApiError.badRequest('You cannot change the status of your own account');
  }

  const existing = await userRepository.findById(id);

  if (!existing) {
    throw ApiError.notFound('Employee not found');
  }

  assertVisible(actor, existing);
  assertMayAssignRole(actor, existing.role);

  const updated = await userRepository.updateById(id, { status });

  if (!updated) {
    throw ApiError.notFound('Employee not found');
  }

  return updated;
};

/**
 * Users change their own password by proving the current one; an admin can
 * reset someone else's without it, which is what a forgotten password needs.
 */
export const changePassword = async (
  actor: AuthenticatedUser,
  id: string,
  input: { currentPassword?: string | undefined; newPassword: string },
): Promise<void> => {
  const isSelf = id === actor.id;

  if (!isSelf) {
    assertRole(actor, MANAGE_ROLE);
  }

  const user = await userRepository.findByIdWithSecret(id);

  if (!user) {
    throw ApiError.notFound('Employee not found');
  }

  assertVisible(actor, user);

  if (isSelf) {
    if (!input.currentPassword) {
      throw ApiError.badRequest('The current password is required');
    }

    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw ApiError.badRequest('The current password is incorrect');
    }
  } else {
    assertMayAssignRole(actor, user.role);
  }

  await userRepository.updateById(id, { passwordHash: await hashPassword(input.newPassword) });
};

/** Removes the hash from a document that was read with it selected. */
const stripSecret = (user: UserDocument): UserDocument => {
  const { passwordHash: _hash, ...rest } = user;

  return rest as UserDocument;
};
