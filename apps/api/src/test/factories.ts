import { DEFAULT_TIMEZONE, type AuthenticatedUser, type UserRole } from '@hadiya/shared';
import type { Express } from 'express';
import type { HydratedDocument } from 'mongoose';
import request from 'supertest';

import { hashPassword } from '../core/security/password.js';
import { BranchModel, type BranchDocument } from '../modules/branches/branch.model.js';
import { UserModel, type UserDocument } from '../modules/users/user.model.js';

/**
 * Fixtures for tests only. Nothing here is imported by the application: real
 * records are created through the API or the owner bootstrap script.
 *
 * Hydrated documents are returned so a test can read `_id` directly.
 */
export const TEST_PASSWORD = 'correct-horse-battery';

/** Prices are in tiyin: 1_200_000 is 12 000 UZS. */
export const COLA_PRICE = 1_200_000;
export const COLA_COST = 900_000;

const suffix = (): string => Math.random().toString(36).slice(2, 8);

export const createTestBranch = (
  overrides: Partial<BranchDocument> = {},
): Promise<HydratedDocument<BranchDocument>> =>
  BranchModel.create({
    name: 'Chilonzor',
    code: `BR${suffix().toUpperCase()}`,
    address: 'Bunyodkor avenue 12',
    phone: '+998901234567',
    isActive: true,
    ...overrides,
  });

export const createTestUser = async (
  role: UserRole,
  branchId: string | null,
  overrides: Partial<UserDocument> = {},
): Promise<HydratedDocument<UserDocument>> =>
  UserModel.create({
    username: `${role}-${suffix()}`,
    passwordHash: await hashPassword(TEST_PASSWORD),
    fullName: `Test ${role}`,
    role,
    status: 'active',
    phone: null,
    branch: branchId,
    timezone: DEFAULT_TIMEZONE,
    lastLoginAt: null,
    ...overrides,
  });

/**
 * The principal a service call would receive for a stored user. Built here so
 * a new field on `AuthenticatedUser` is added once rather than in every suite.
 */
export const actorFor = (
  user: HydratedDocument<UserDocument>,
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser => ({
  id: String(user._id),
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  branchId: user.branch ? String(user.branch) : null,
  timezone: user.timezone,
  ...overrides,
});

/** Signs in through the real login endpoint and returns a bearer header. */
export const signIn = async (app: Express, username: string): Promise<string> => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ username, password: TEST_PASSWORD });

  if (response.status !== 200) {
    throw new Error(`Test sign-in failed: ${response.status} ${JSON.stringify(response.body)}`);
  }

  const token: unknown = response.body?.data?.tokens?.accessToken;

  if (typeof token !== 'string') {
    throw new Error('Test sign-in returned no access token');
  }

  return `Bearer ${token}`;
};

/** Creates an employee with the given role and signs them in. */
export const signInAs = async (
  app: Express,
  role: UserRole,
  branchId: string | null,
  overrides: Partial<UserDocument> = {},
): Promise<{
  user: HydratedDocument<UserDocument>;
  authorization: string;
  actor: AuthenticatedUser;
}> => {
  const user = await createTestUser(role, branchId, overrides);

  return {
    user,
    authorization: await signIn(app, user.username),
    actor: actorFor(user),
  };
};
