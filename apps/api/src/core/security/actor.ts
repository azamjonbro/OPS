import { hasAtLeastRole, type AuthenticatedUser, type UserRole } from '@hadiya/shared';
import type { Request } from 'express';

import { ApiError } from '../http/api-error.js';

/**
 * From this role upwards a user is not tied to a single branch: they may read
 * and write across the whole organisation.
 */
const ORGANISATION_WIDE_ROLE: UserRole = 'admin';

/**
 * Reads the principal set by `authenticate`. Throwing rather than returning
 * `undefined` keeps handlers free of null checks: a route that reaches a
 * handler without a principal is a wiring mistake, not a client error.
 */
export const requireActor = (req: Request): AuthenticatedUser => {
  if (!req.user) {
    throw ApiError.unauthenticated();
  }

  return req.user;
};

export const canAccessAllBranches = (actor: AuthenticatedUser): boolean =>
  hasAtLeastRole(actor.role, ORGANISATION_WIDE_ROLE);

/** The actor's own branch, for staff whose access is limited to one. */
export const requireActorBranch = (actor: AuthenticatedUser): string => {
  if (!actor.branchId) {
    throw ApiError.forbidden('Your account is not assigned to a branch');
  }

  return actor.branchId;
};

export const assertRole = (actor: AuthenticatedUser, minimum: UserRole): void => {
  if (!hasAtLeastRole(actor.role, minimum)) {
    throw ApiError.forbidden(`This action requires the ${minimum} role or higher`);
  }
};

/**
 * Decides which branch a write belongs to.
 *
 * Branch-bound staff may only write to their own branch, and passing a
 * different one is a 403 rather than a silent redirect. Organisation-wide roles
 * must name the branch explicitly — there is no sensible default for them.
 */
export const resolveBranchForWrite = (
  actor: AuthenticatedUser,
  requestedBranchId?: string | null,
): string => {
  if (canAccessAllBranches(actor)) {
    const branchId = requestedBranchId ?? actor.branchId;

    if (!branchId) {
      throw ApiError.badRequest('branchId is required for this action');
    }

    return branchId;
  }

  if (!actor.branchId) {
    throw ApiError.forbidden('Your account is not assigned to a branch');
  }

  if (requestedBranchId && requestedBranchId !== actor.branchId) {
    throw ApiError.forbidden('You may only act on your own branch');
  }

  return actor.branchId;
};

/**
 * Decides which branch a read covers: the requested one for organisation-wide
 * roles (or all branches when they ask for none), and always their own for
 * branch-bound staff.
 */
export const resolveBranchForRead = (
  actor: AuthenticatedUser,
  requestedBranchId?: string | null,
): string | null => {
  if (canAccessAllBranches(actor)) {
    return requestedBranchId ?? null;
  }

  if (!actor.branchId) {
    throw ApiError.forbidden('Your account is not assigned to a branch');
  }

  if (requestedBranchId && requestedBranchId !== actor.branchId) {
    throw ApiError.forbidden('You may only read your own branch');
  }

  return actor.branchId;
};

/**
 * Guards a document that has already been read: branch-bound staff may not
 * touch a record belonging to another branch.
 */
export const assertBranchAccess = (
  actor: AuthenticatedUser,
  branchId: string | null | undefined,
): void => {
  if (canAccessAllBranches(actor)) {
    return;
  }

  if (!branchId || branchId !== actor.branchId) {
    throw ApiError.forbidden('This record belongs to another branch');
  }
};
