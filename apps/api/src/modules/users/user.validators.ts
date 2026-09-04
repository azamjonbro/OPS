import { objectIdSchema, paginationQuerySchema, USER_ROLES, USER_STATUSES } from '@hadiya/shared';
import { z } from 'zod';

const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9._-]+$/, 'Only letters, digits, dot, underscore and hyphen are allowed');

/** Long enough to resist guessing; the upper bound keeps scrypt cost bounded. */
export const passwordSchema = z.string().min(8).max(128);

const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9\s-]{7,20}$/, 'Must be a valid phone number');

export const createUserSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(120),
  role: z.enum(USER_ROLES),
  phone: phoneSchema.nullish(),
  branchId: objectIdSchema.nullish(),
});

export const updateUserSchema = z
  .object({
    fullName: z.string().trim().min(2).max(120),
    role: z.enum(USER_ROLES),
    phone: phoneSchema.nullable(),
    branchId: objectIdSchema.nullable(),
  })
  .partial();

export const updateUserStatusSchema = z.object({
  status: z.enum(USER_STATUSES),
});

export const changePasswordSchema = z.object({
  /** Required when a user changes their own password; admins may reset without it. */
  currentPassword: passwordSchema.optional(),
  newPassword: passwordSchema,
});

export const listUsersQuerySchema = paginationQuerySchema.extend({
  branchId: objectIdSchema.optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(USER_STATUSES).optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const userIdParamSchema = z.object({ id: objectIdSchema });

export type CreateUserInput = z.output<typeof createUserSchema>;
export type UpdateUserInput = z.output<typeof updateUserSchema>;
export type ListUsersQuery = z.output<typeof listUsersQuerySchema>;
