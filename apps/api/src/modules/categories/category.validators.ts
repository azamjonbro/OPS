import { booleanQuerySchema, objectIdSchema, paginationQuerySchema } from '@hadiya/shared';
import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(500).nullish(),
  parentId: objectIdSchema.nullish(),
});

export const updateCategorySchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).nullable(),
    parentId: objectIdSchema.nullable(),
    isActive: z.boolean(),
  })
  .partial();

export const listCategoriesQuerySchema = paginationQuerySchema.extend({
  parentId: objectIdSchema.optional(),
  isActive: booleanQuerySchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const categoryIdParamSchema = z.object({ id: objectIdSchema });

export type CreateCategoryInput = z.output<typeof createCategorySchema>;
export type UpdateCategoryInput = z.output<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.output<typeof listCategoriesQuerySchema>;
