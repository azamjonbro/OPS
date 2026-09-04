import {
  booleanQuerySchema,
  IMAGE_ASPECT_RATIOS,
  IMAGE_ASSET_STATUSES,
  IMAGE_MAX_COUNT,
  IMAGE_PROMPT_MAX_LENGTH,
  IMAGE_PROMPT_MIN_LENGTH,
  IMAGE_QUALITIES,
  IMAGE_STYLES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * Everything a client may say about an image.
 *
 * There is deliberately no field for a path, a filename, a URL or a storage
 * key: those are chosen by the server from object ids. A request that could
 * name where its bytes go is a path traversal waiting to happen, so the
 * vocabulary simply does not contain one.
 */
export const generateImageSchema = z.object({
  prompt: z.string().trim().min(IMAGE_PROMPT_MIN_LENGTH).max(IMAGE_PROMPT_MAX_LENGTH),
  aspectRatio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
  quality: z.enum(IMAGE_QUALITIES).optional(),
  style: z.enum(IMAGE_STYLES).optional(),
  count: z.number().int().min(1).max(IMAGE_MAX_COUNT).optional(),
  contentItemId: objectIdSchema.nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const listImagesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(IMAGE_ASSET_STATUSES).optional(),
  contentItemId: objectIdSchema.optional(),
  unattached: booleanQuerySchema.optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

/** `null` detaches, which is why it is nullable rather than simply optional. */
export const attachImageSchema = z.object({
  contentItemId: objectIdSchema.nullable(),
});

export const imageIdParamSchema = z.object({ id: objectIdSchema });
