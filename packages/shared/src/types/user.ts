import type { UserRole } from '../constants/roles.js';
import type { UserStatus } from '../constants/users.js';
import type { Entity } from './entity.js';

/**
 * An employee account. The password hash never leaves the API, so it has no
 * place in this type.
 */
export interface User extends Entity {
  username: string;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  phone: string | null;
  /** Id of the branch the employee works at; `null` means organisation-wide. */
  branch: string | null;
  /**
   * IANA zone the employee's wall clock is read in, e.g. `Asia/Tashkent`.
   * Reminders are set and shown in it, so it is a property of the account
   * rather than of the browser that happens to be open.
   */
  timezone: string;
  /** ISO-8601, or `null` if the account has never signed in. */
  lastLoginAt: string | null;
}
