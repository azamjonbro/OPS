import { objectIdSchema, paginationQuerySchema } from '@hadiya/shared';
import { z } from 'zod';

export const listFilesQuerySchema = paginationQuerySchema;

export const fileIdParamSchema = z.object({ id: objectIdSchema });
