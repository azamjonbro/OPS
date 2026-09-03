/**
 * Roles are ordered from least to most privileged; the index in this tuple is
 * the privilege rank used by `hasAtLeastRole`.
 */
export const USER_ROLES = ['cashier', 'employee', 'manager', 'admin', 'owner'] as const;

export type UserRole = (typeof USER_ROLES)[number];

const ROLE_RANK: Readonly<Record<UserRole, number>> = Object.freeze(
  Object.fromEntries(USER_ROLES.map((role, index) => [role, index])) as Record<UserRole, number>,
);

export const isUserRole = (value: unknown): value is UserRole =>
  typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);

/** True when `role` is at least as privileged as `required`. */
export const hasAtLeastRole = (role: UserRole, required: UserRole): boolean =>
  ROLE_RANK[role] >= ROLE_RANK[required];
