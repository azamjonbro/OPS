import {
  DEFAULT_TIMEZONE,
  type AuthenticatedUser,
  type AuthTokens,
  type LoginResult,
} from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';
import {
  accessTokenLifetimeSeconds,
  signAccessToken,
  signRefreshToken,
  verifyToken,
} from '../../core/security/tokens.js';
import { verifyPassword } from '../../core/security/password.js';
import { userRepository } from '../users/user.repository.js';
import type { UserDocument } from '../users/user.model.js';

/** The principal shape carried in a token and attached to every request. */
export const toActor = (user: UserDocument): AuthenticatedUser => ({
  id: String(user._id),
  username: user.username,
  fullName: user.fullName,
  role: user.role,
  branchId: user.branch ? String(user.branch) : null,
  // Accounts created before the field existed have no stored zone; falling back
  // keeps every time-shaped feature working rather than failing on a blank.
  timezone: user.timezone || DEFAULT_TIMEZONE,
});

const issueTokens = async (user: UserDocument): Promise<AuthTokens> => ({
  accessToken: await signAccessToken(toActor(user)),
  refreshToken: await signRefreshToken(String(user._id)),
  expiresIn: accessTokenLifetimeSeconds(),
});

const withoutSecret = (user: UserDocument): Omit<UserDocument, 'passwordHash'> => {
  const { passwordHash: _hash, ...rest } = user;

  return rest;
};

/**
 * Wrong username and wrong password produce the same error, so the endpoint
 * cannot be used to find out which accounts exist. A suspended account is
 * rejected the same way.
 */
export const login = async (input: {
  username: string;
  password: string;
}): Promise<LoginResult> => {
  const user = await userRepository.findByUsernameWithSecret(input.username);

  if (!user || user.status !== 'active') {
    // Still hash-compare on the miss path so a failed lookup is not measurably
    // faster than a wrong password.
    await verifyPassword(input.password, 'scrypt$16384$8$1$aGFkaXlh$aGFkaXlh');
    throw ApiError.unauthenticated('Invalid username or password');
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    throw ApiError.unauthenticated('Invalid username or password');
  }

  const now = new Date();
  await userRepository.touchLastLogin(String(user._id), now);

  const tokens = await issueTokens(user);

  return {
    user: withoutSecret({ ...user, lastLoginAt: now }) as unknown as LoginResult['user'],
    tokens,
  };
};

/**
 * Exchanges a refresh token for a new pair. The user is re-read so a suspended
 * or re-assigned account cannot keep refreshing with stale claims.
 */
export const refresh = async (refreshToken: string): Promise<AuthTokens> => {
  const { subject } = await verifyToken(refreshToken, 'refresh');
  const user = await userRepository.findById(subject);

  if (!user || user.status !== 'active') {
    throw ApiError.unauthenticated('Invalid token');
  }

  return issueTokens(user);
};

/**
 * Resolves the principal for an access token. The account is re-read on every
 * request so a suspension, role change or branch move takes effect immediately
 * instead of when the token happens to expire.
 */
export const resolveActor = async (accessToken: string): Promise<AuthenticatedUser> => {
  const { subject } = await verifyToken(accessToken, 'access');
  const user = await userRepository.findById(subject);

  if (!user || user.status !== 'active') {
    throw ApiError.unauthenticated('Invalid token');
  }

  return toActor(user);
};

export const currentUser = async (actorId: string): Promise<Omit<UserDocument, 'passwordHash'>> => {
  const user = await userRepository.findById(actorId);

  if (!user) {
    throw ApiError.unauthenticated();
  }

  return withoutSecret(user);
};
