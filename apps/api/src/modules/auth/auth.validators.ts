import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().trim().toLowerCase().min(3).max(40),
  /** No format rules on login: the stored password decides, not the schema. */
  password: z.string().min(1).max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export type LoginInput = z.output<typeof loginSchema>;
