import { z } from 'zod';

import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.js';
import { OBJECT_ID_REGEX } from '../utils/identifiers.js';

export const objectIdSchema = z
  .string()
  .regex(OBJECT_ID_REGEX, 'Must be a 24-character hexadecimal object id');

export const isoDateStringSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be an ISO-8601 date string');

export const sortDirectionSchema = z.enum(['asc', 'desc']);

/** Query-string pagination: values arrive as strings and are coerced. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(DEFAULT_PAGE),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.output<typeof paginationQuerySchema>;

export const idParamSchema = z.object({ id: objectIdSchema });

export type IdParam = z.output<typeof idParamSchema>;
