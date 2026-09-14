import {
  FILE_CATEGORIES,
  FILE_TITLE_MAX_LENGTH,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * The text fields that may travel beside the bytes in an upload.
 *
 * Both optional, because a chat attachment sends neither. A title replaces the
 * filename as what the person sees — "Sotuv strategiyasi 2026" rather than
 * `strategiya_final_v3 (2).pdf` — and a category is what puts the document in
 * the knowledge base at all.
 */
const optionalField = <T extends z.ZodType>(schema: T) =>
  // A browser form sends an untouched field as `""`, which is the same as not
  // sending it; and a request with no fields at all has no body to parse.
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

export const uploadFieldsSchema = z
  .object({
    title: optionalField(z.string().trim().min(1).max(FILE_TITLE_MAX_LENGTH)),
    category: optionalField(z.enum(FILE_CATEGORIES)),
  })
  .default({});

const queryBoolean = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean().optional(),
);

export const listFilesQuerySchema = paginationQuerySchema.extend({
  category: z.enum(FILE_CATEGORIES).optional(),
  /** `true` lists only knowledge-base documents; `false` only attachments. */
  knowledgeBase: queryBoolean,
});

export const fileIdParamSchema = z.object({ id: objectIdSchema });
