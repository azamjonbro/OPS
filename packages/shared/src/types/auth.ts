import type { UserRole } from '../constants/roles.js';
import type { User } from './user.js';

/**
 * The principal carried by an access token and attached to every authenticated
 * request. Deliberately smaller than `User`: it holds only what authorization
 * decisions need, so nothing else has to be re-read from the token.
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  /** Branch the user is scoped to, or `null` for organisation-wide access. */
  branchId: string | null;
  /**
   * IANA zone the user's wall clock is read in. Carried on the principal
   * because almost everything time-shaped needs it — a reminder for "10:00",
   * the current time the assistant is told — and re-reading the account on
   * every such call would be the same lookup done later and less reliably.
   */
  timezone: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface LoginResult {
  user: User;
  tokens: AuthTokens;
}

export interface RefreshResult {
  tokens: AuthTokens;
}
