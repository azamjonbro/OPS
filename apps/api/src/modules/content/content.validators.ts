import {
  CONTENT_CAPTION_MAX_LENGTH,
  CONTENT_CTA_MAX_LENGTH,
  CONTENT_HASHTAG_MAX_LENGTH,
  CONTENT_IDEA_MAX_LENGTH,
  CONTENT_ITEM_STATUSES,
  CONTENT_ITEM_TITLE_MAX_LENGTH,
  CONTENT_MAX_HASHTAGS,
  CONTENT_NOTES_MAX_LENGTH,
  CONTENT_PLAN_DESCRIPTION_MAX_LENGTH,
  CONTENT_PLAN_MAX_DAYS,
  CONTENT_PLAN_MAX_ITEMS,
  CONTENT_PLAN_STATUSES,
  CONTENT_PLAN_TITLE_MAX_LENGTH,
  CONTENT_PLATFORMS,
  CONTENT_TYPES,
  objectIdSchema,
  paginationQuerySchema,
} from '@hadiya/shared';
import { z } from 'zod';

/** Stored without a leading `#`, so one is stripped rather than rejected. */
const hashtagSchema = z
  .string()
  .trim()
  .min(1)
  .max(CONTENT_HASHTAG_MAX_LENGTH)
  .transform((value) => value.replace(/^#+/, ''));

const hashtagsSchema = z.array(hashtagSchema).max(CONTENT_MAX_HASHTAGS);

const platformSchema = z.enum(CONTENT_PLATFORMS);
const contentTypeSchema = z.enum(CONTENT_TYPES);

export const contentItemInputSchema = z.object({
  date: z.coerce.date(),
  platform: platformSchema.optional(),
  contentType: contentTypeSchema,
  title: z.string().trim().min(1).max(CONTENT_ITEM_TITLE_MAX_LENGTH),
  idea: z.string().trim().min(1).max(CONTENT_IDEA_MAX_LENGTH),
  caption: z.string().trim().max(CONTENT_CAPTION_MAX_LENGTH).nullish(),
  callToAction: z.string().trim().max(CONTENT_CTA_MAX_LENGTH).nullish(),
  hashtags: hashtagsSchema.optional(),
  status: z.enum(CONTENT_ITEM_STATUSES).optional(),
  notes: z.string().trim().max(CONTENT_NOTES_MAX_LENGTH).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const createContentPlanSchema = z.object({
  title: z.string().trim().min(1).max(CONTENT_PLAN_TITLE_MAX_LENGTH),
  description: z.string().trim().max(CONTENT_PLAN_DESCRIPTION_MAX_LENGTH).nullish(),
  platform: platformSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  status: z.enum(CONTENT_PLAN_STATUSES).optional(),
  /** Days may be supplied with the plan, or added one at a time afterwards. */
  items: z.array(contentItemInputSchema).max(CONTENT_PLAN_MAX_ITEMS).optional(),
  conversationId: objectIdSchema.nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const updateContentPlanSchema = z.object({
  title: z.string().trim().min(1).max(CONTENT_PLAN_TITLE_MAX_LENGTH).optional(),
  description: z.string().trim().max(CONTENT_PLAN_DESCRIPTION_MAX_LENGTH).nullish(),
  platform: platformSchema.optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  status: z.enum(CONTENT_PLAN_STATUSES).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const listContentPlansQuerySchema = paginationQuerySchema.extend({
  status: z.enum(CONTENT_PLAN_STATUSES).optional(),
  platform: platformSchema.optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const updateContentItemSchema = z.object({
  date: z.coerce.date().optional(),
  platform: platformSchema.optional(),
  contentType: contentTypeSchema.optional(),
  title: z.string().trim().min(1).max(CONTENT_ITEM_TITLE_MAX_LENGTH).optional(),
  idea: z.string().trim().min(1).max(CONTENT_IDEA_MAX_LENGTH).optional(),
  caption: z.string().trim().max(CONTENT_CAPTION_MAX_LENGTH).nullish(),
  callToAction: z.string().trim().max(CONTENT_CTA_MAX_LENGTH).nullish(),
  hashtags: hashtagsSchema.optional(),
  status: z.enum(CONTENT_ITEM_STATUSES).optional(),
  notes: z.string().trim().max(CONTENT_NOTES_MAX_LENGTH).nullish(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const listContentItemsQuerySchema = paginationQuerySchema.extend({
  planId: objectIdSchema.optional(),
  status: z.enum(CONTENT_ITEM_STATUSES).optional(),
  platform: platformSchema.optional(),
  contentType: contentTypeSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Asking the assistant for a plan through REST rather than through chat. */
export const generateContentPlanSchema = z.object({
  brief: z.string().trim().min(3).max(1_000),
  platform: platformSchema.optional(),
  days: z.number().int().min(1).max(CONTENT_PLAN_MAX_DAYS).optional(),
  startDate: z.coerce.date().optional(),
  title: z.string().trim().min(1).max(CONTENT_PLAN_TITLE_MAX_LENGTH).optional(),
  contentTypes: z.array(contentTypeSchema).max(CONTENT_TYPES.length).optional(),
  businessContext: z.string().trim().max(4_000).optional(),
  /** False previews the plan without storing it. */
  save: z.boolean().optional(),
});

export const generateCaptionSchema = z.object({
  topic: z.string().trim().min(3).max(1_000),
  platform: platformSchema.optional(),
  contentType: contentTypeSchema.optional(),
  existingCaption: z.string().trim().max(CONTENT_CAPTION_MAX_LENGTH).optional(),
  instruction: z.string().trim().max(500).optional(),
  businessContext: z.string().trim().max(4_000).optional(),
});

export const regenerateContentItemSchema = z.object({
  instruction: z.string().trim().max(500).optional(),
  fields: z
    .array(z.enum(['caption', 'hashtags', 'idea', 'title', 'callToAction']))
    .max(5)
    .optional(),
  businessContext: z.string().trim().max(4_000).optional(),
});

export const contentPlanIdParamSchema = z.object({ id: objectIdSchema });
export const contentItemIdParamSchema = z.object({ id: objectIdSchema });
export const planItemParamsSchema = z.object({ id: objectIdSchema });
