import {
  CONTENT_CAPTION_MAX_LENGTH,
  CONTENT_CTA_MAX_LENGTH,
  CONTENT_HASHTAG_MAX_LENGTH,
  CONTENT_IDEA_MAX_LENGTH,
  CONTENT_ITEM_TITLE_MAX_LENGTH,
  CONTENT_MAX_HASHTAGS,
  CONTENT_PLAN_MAX_ITEMS,
  CONTENT_TYPES,
} from '@hadiya/shared';
import { z } from 'zod';

/**
 * The shapes a model is allowed to return.
 *
 * These are the contract, not a suggestion: anything that does not match is
 * refused and nothing invalid is stored. They are also what the prompt is
 * generated from, so the instructions and the validation can never drift — a
 * field added here appears in the brief automatically.
 *
 * The coercions below are the one place leniency is allowed, and each has a
 * single obvious reading: a hashtag written `#Sale` means `sale`, and a model
 * that returns one hashtag as a string rather than a list of one meant the
 * list. Nothing here invents a value that was not there.
 */

/** `#Yangi Mahsulot` -> `yangimahsulot`. Punctuation and spacing are noise. */
const normaliseHashtag = (value: string): string =>
  value
    .trim()
    .replace(/^#+/, '')
    .replace(/\s+/g, '')
    .replace(/[^\p{L}\p{N}_]/gu, '')
    .slice(0, CONTENT_HASHTAG_MAX_LENGTH);

export const hashtagsSchema = z
  .preprocess(
    // A single hashtag sometimes arrives as a bare string, and a comma- or
    // space-separated line is the other common shape.
    (value) => {
      if (typeof value === 'string') {
        return value.split(/[,\s]+/).filter((entry) => entry.length > 0);
      }

      return value ?? [];
    },
    z.array(z.string()).max(CONTENT_MAX_HASHTAGS * 2),
  )
  .transform((tags) => {
    const seen = new Set<string>();

    for (const tag of tags) {
      const normalised = normaliseHashtag(tag);

      if (normalised.length > 0) {
        seen.add(normalised);
      }
    }

    return [...seen].slice(0, CONTENT_MAX_HASHTAGS);
  });

/**
 * The content type, accepted case-insensitively and falling back to `other`.
 *
 * A model that answers "Reel" has understood the task; rejecting the whole plan
 * over the capital letter would be pedantry. An unrecognised type becomes
 * `other` rather than failing, because the item's own words still carry the
 * meaning and `other` is what the vocabulary provides for exactly this.
 */
export const contentTypeSchema = z.preprocess((value) => {
  if (typeof value !== 'string') {
    return 'other';
  }

  const candidate = value.trim().toLowerCase().replace(/\s+/g, '_');

  return (CONTENT_TYPES as readonly string[]).includes(candidate) ? candidate : 'other';
}, z.enum(CONTENT_TYPES));

const requiredText = (max: number) => z.string().trim().min(1).max(max);

/** Optional prose, with an empty string treated as absent rather than as `""`. */
const optionalText = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? null : value),
    z.string().trim().max(max).nullish(),
  );

/**
 * One day of a plan.
 *
 * `dayOffset` rather than a date: the model is bad at calendars and good at
 * ordering, so it says "the third day" and the service works out which date
 * that is from the plan's start. That also means a plan can be moved without
 * re-asking the model.
 */
export const generatedItemSchema = z.object({
  dayOffset: z.coerce.number().int().min(0).max(CONTENT_PLAN_MAX_ITEMS),
  contentType: contentTypeSchema,
  title: requiredText(CONTENT_ITEM_TITLE_MAX_LENGTH),
  idea: requiredText(CONTENT_IDEA_MAX_LENGTH),
  caption: requiredText(CONTENT_CAPTION_MAX_LENGTH),
  callToAction: optionalText(CONTENT_CTA_MAX_LENGTH),
  hashtags: hashtagsSchema,
});

export type GeneratedItem = z.output<typeof generatedItemSchema>;

export const generatedPlanSchema = z.object({
  title: requiredText(160),
  description: optionalText(2_000),
  items: z.array(generatedItemSchema).min(1).max(CONTENT_PLAN_MAX_ITEMS),
});

export type GeneratedPlan = z.output<typeof generatedPlanSchema>;

export const generatedCaptionSchema = z.object({
  caption: requiredText(CONTENT_CAPTION_MAX_LENGTH),
  callToAction: optionalText(CONTENT_CTA_MAX_LENGTH),
  hashtags: hashtagsSchema,
});

export type GeneratedCaptionOutput = z.output<typeof generatedCaptionSchema>;

export const generatedIdeaSchema = z.object({
  title: requiredText(CONTENT_ITEM_TITLE_MAX_LENGTH),
  idea: requiredText(CONTENT_IDEA_MAX_LENGTH),
  contentType: contentTypeSchema,
  angle: requiredText(500),
  hashtags: hashtagsSchema,
});

export const generatedIdeasSchema = z.object({
  ideas: z.array(generatedIdeaSchema).min(1).max(50),
});

export type GeneratedIdeas = z.output<typeof generatedIdeasSchema>;

/** A single rewritten item, for `regenerate_content_item`. */
export const regeneratedItemSchema = z.object({
  title: requiredText(CONTENT_ITEM_TITLE_MAX_LENGTH),
  idea: requiredText(CONTENT_IDEA_MAX_LENGTH),
  contentType: contentTypeSchema.optional(),
  caption: requiredText(CONTENT_CAPTION_MAX_LENGTH),
  callToAction: optionalText(CONTENT_CTA_MAX_LENGTH),
  hashtags: hashtagsSchema,
});

export type RegeneratedItem = z.output<typeof regeneratedItemSchema>;
