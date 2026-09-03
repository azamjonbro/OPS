import type { UserRole } from '../constants/roles.js';

/**
 * The authenticated principal as exposed to clients. Populated by the auth
 * module in a later phase; declared here so the web app and the API agree on
 * the shape from the start.
 */
export interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  /** Branch the user is scoped to, or `null` for organisation-wide access. */
  branchId: string | null;
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
  user: AuthenticatedUser;
  tokens: AuthTokens;
}
