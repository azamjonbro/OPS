import { booleanQuerySchema, objectIdSchema, paginationQuerySchema } from '@hadiya/shared';
import { z } from 'zod';

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2)
  .max(24)
  .regex(/^[A-Z0-9_-]+$/, 'Only capital letters, digits, underscore and hyphen are allowed');

export const createBranchSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: codeSchema,
  address: z.string().trim().max(240).nullish(),
  phone: z.string().trim().max(32).nullish(),
});

export const updateBranchSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    code: codeSchema,
    address: z.string().trim().max(240).nullable(),
    phone: z.string().trim().max(32).nullable(),
    isActive: z.boolean(),
  })
  .partial();

export const listBranchesQuerySchema = paginationQuerySchema.extend({
  isActive: booleanQuerySchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const branchIdParamSchema = z.object({ id: objectIdSchema });

export type CreateBranchInput = z.output<typeof createBranchSchema>;
export type UpdateBranchInput = z.output<typeof updateBranchSchema>;
export type ListBranchesQuery = z.output<typeof listBranchesQuerySchema>;
