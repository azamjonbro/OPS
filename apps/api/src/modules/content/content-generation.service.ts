import {
  CONTENT_IDEAS_DEFAULT,
  CONTENT_PLAN_DEFAULT_DAYS,
  CONTENT_PLAN_MAX_DAYS,
  type AuthenticatedUser,
  type ContentIdea,
  type ContentPlatform,
  type ContentPreferences,
  type ContentType,
  type GeneratedCaption,
} from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import type { AiProvider } from '../ai/provider/index.js';
import type { ContentItemDocument } from './content-item.model.js';
import type { ContentPlanDocument } from './content-plan.model.js';
import { loadContentPreferences } from './content-preferences.js';
import * as contentService from './content.service.js';
import { generateStructured, type GenerationOutcome } from './generation/content-generator.js';
import {
  buildCaptionBrief,
  buildIdeasBrief,
  buildPlanBrief,
  buildRegenerateBrief,
} from './generation/content-prompts.js';
import {
  generatedCaptionSchema,
  generatedIdeasSchema,
  generatedPlanSchema,
  regeneratedItemSchema,
  type GeneratedPlan,
} from './generation/content-schemas.js';

const log = createLogger('content-generation');

/**
 * Generation, and what happens to the result.
 *
 * The split with `content.service.ts` is deliberate: that one persists what it
 * is given and knows nothing about models, this one asks a model and then hands
 * the validated answer over to be persisted. Nothing generated is stored until
 * it has passed the schema, so a bad reply costs a retry and never a corrupt
 * plan.
 *
 * Business context is a parameter, never a query made here. The assistant
 * decides whether a plan should be based on last month's best sellers and
 * gathers that itself with the read-only sales tool; this module would
 * otherwise turn every "write me a caption" into an unasked-for report query.
 */

/** Turns a generator failure into the one error shape callers handle. */
const generationFailed = (outcome: { message: string; issues: string[] }): ApiError =>
  ApiError.dependencyUnavailable(
    `The assistant could not produce usable content: ${outcome.message}`,
    { details: { kind: 'content_generation_failed', issues: outcome.issues.slice(0, 10) } },
  );

export interface GenerationDependencies {
  provider?: AiProvider | undefined;
  /** Injected so a test can assert on the exact instant a plan starts. */
  now?: Date | undefined;
  /** Skips the memory read when a caller already has the preferences. */
  preferences?: ContentPreferences | undefined;
}

const resolvePreferences = async (
  actor: AuthenticatedUser,
  dependencies: GenerationDependencies,
): Promise<ContentPreferences> =>
  dependencies.preferences ?? (await loadContentPreferences(actor));

export interface GeneratePlanInput {
  /** What the plan is for, in the user's own words. */
  brief: string;
  platform?: ContentPlatform | undefined;
  days?: number | undefined;
  startDate?: Date | undefined;
  title?: string | undefined;
  contentTypes?: ContentType[] | undefined;
  /** Figures the caller gathered; never read from the database here. */
  businessContext?: string | undefined;
  conversationId?: string | null | undefined;
  /** False returns the plan without storing it, for a preview. */
  save?: boolean | undefined;
}

export interface GeneratedPlanResult {
  plan: ContentPlanDocument | null;
  items: contentService.ContentItemInput[];
  generated: GeneratedPlan;
  preferences: ContentPreferences;
  model: string;
  attempts: number;
}

/**
 * Generates a plan and, unless asked not to, saves it.
 *
 * The model returns `dayOffset` rather than dates. It is unreliable at
 * calendars and reliable at ordering, so the dates are computed here from the
 * start date — which also means a generated plan can be moved later without
 * asking the model anything.
 */
export const generatePlan = async (
  actor: AuthenticatedUser,
  input: GeneratePlanInput,
  dependencies: GenerationDependencies = {},
): Promise<GeneratedPlanResult> => {
  const days = Math.min(Math.max(input.days ?? CONTENT_PLAN_DEFAULT_DAYS, 1), CONTENT_PLAN_MAX_DAYS);
  const platform = input.platform ?? 'instagram';
  const preferences = await resolvePreferences(actor, dependencies);
  const startDate = contentService.toDay(
    input.startDate ?? dependencies.now ?? new Date(),
  );

  const outcome: GenerationOutcome<GeneratedPlan> = await generateStructured({
    brief: buildPlanBrief({
      platform,
      preferences,
      days,
      startDate: startDate.toISOString().slice(0, 10),
      brief: input.brief,
      businessContext: input.businessContext,
      contentTypes: input.contentTypes,
    }),
    schema: generatedPlanSchema,
    provider: dependencies.provider,
  });

  if (!outcome.ok) {
    throw generationFailed(outcome);
  }

  const items: contentService.ContentItemInput[] = outcome.data.items.map((item) => ({
    // Clamped rather than rejected: a model that numbered a seven-day plan 1-7
    // instead of 0-6 has produced seven usable days, and losing them to an
    // off-by-one would be the wrong call. Order is preserved either way.
    date: contentService.addDays(startDate, Math.min(item.dayOffset, days - 1)),
    platform,
    contentType: item.contentType,
    title: item.title,
    idea: item.idea,
    caption: item.caption,
    callToAction: item.callToAction ?? null,
    hashtags: item.hashtags,
    status: 'draft' as const,
  }));

  if (input.save === false) {
    return { plan: null, items, generated: outcome.data, preferences, model: outcome.model, attempts: outcome.attempts };
  }

  const plan = await contentService.createPlan(actor, {
    title: input.title?.trim() || outcome.data.title,
    description: outcome.data.description ?? input.brief,
    platform,
    startDate,
    endDate: contentService.addDays(startDate, days - 1),
    status: 'draft',
    items,
    conversationId: input.conversationId ?? null,
    // Kept so a plan can be explained later: what was asked for, and what it
    // was based on.
    metadata: {
      brief: input.brief,
      generatedBy: outcome.model,
      ...(input.businessContext ? { businessContext: input.businessContext } : {}),
      ...(describePreferencesForMetadata(preferences) ?? {}),
    },
  });

  log.info(
    { planId: String(plan._id), days, platform, attempts: outcome.attempts },
    'content plan generated',
  );

  return { plan, items, generated: outcome.data, preferences, model: outcome.model, attempts: outcome.attempts };
};

/** Only the preferences that were actually applied land in the record. */
const describePreferencesForMetadata = (
  preferences: ContentPreferences,
): { appliedPreferences: Record<string, string> } | null => {
  const applied = Object.entries(preferences).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string',
  );

  return applied.length > 0 ? { appliedPreferences: Object.fromEntries(applied) } : null;
};

export interface GenerateCaptionInput {
  topic: string;
  platform?: ContentPlatform | undefined;
  contentType?: ContentType | undefined;
  /** Existing copy to work from, for a rewrite rather than a fresh write. */
  existingCaption?: string | undefined;
  instruction?: string | undefined;
  businessContext?: string | undefined;
}

export const generateCaption = async (
  actor: AuthenticatedUser,
  input: GenerateCaptionInput,
  dependencies: GenerationDependencies = {},
): Promise<{ caption: GeneratedCaption; preferences: ContentPreferences; model: string }> => {
  const preferences = await resolvePreferences(actor, dependencies);
  const outcome = await generateStructured({
    brief: buildCaptionBrief({
      platform: input.platform ?? preferences.platform ?? 'instagram',
      preferences,
      topic: input.topic,
      contentType: input.contentType,
      existingCaption: input.existingCaption,
      instruction: input.instruction,
      businessContext: input.businessContext,
    }),
    schema: generatedCaptionSchema,
    provider: dependencies.provider,
  });

  if (!outcome.ok) {
    throw generationFailed(outcome);
  }

  return {
    caption: {
      caption: outcome.data.caption,
      callToAction: outcome.data.callToAction ?? '',
      hashtags: outcome.data.hashtags,
    },
    preferences,
    model: outcome.model,
  };
};

export interface GenerateIdeasInput {
  topic: string;
  platform?: ContentPlatform | undefined;
  count?: number | undefined;
  businessContext?: string | undefined;
}

export const generateIdeas = async (
  actor: AuthenticatedUser,
  input: GenerateIdeasInput,
  dependencies: GenerationDependencies = {},
): Promise<{ ideas: ContentIdea[]; preferences: ContentPreferences; model: string }> => {
  const preferences = await resolvePreferences(actor, dependencies);
  const outcome = await generateStructured({
    brief: buildIdeasBrief({
      platform: input.platform ?? preferences.platform ?? 'instagram',
      preferences,
      topic: input.topic,
      count: input.count ?? CONTENT_IDEAS_DEFAULT,
      businessContext: input.businessContext,
    }),
    schema: generatedIdeasSchema,
    provider: dependencies.provider,
  });

  if (!outcome.ok) {
    throw generationFailed(outcome);
  }

  return { ideas: outcome.data.ideas, preferences, model: outcome.model };
};

export interface RegenerateItemInput {
  itemId: string;
  /** What to change. Absent means "write it again, better". */
  instruction?: string | undefined;
  /** Fields to rewrite. Anything else keeps the value it already had. */
  fields?: Array<'caption' | 'hashtags' | 'idea' | 'title' | 'callToAction'> | undefined;
  businessContext?: string | undefined;
}

/**
 * Rewrites one item in place.
 *
 * `fields` is what keeps "hashtaglarni yangila" from rewriting the caption. The
 * model is shown the whole item so it can stay coherent, but only the named
 * fields are written back — the rest keeps the value the person already
 * approved, which a wholesale regeneration would silently discard.
 */
export const regenerateItem = async (
  actor: AuthenticatedUser,
  input: RegenerateItemInput,
  dependencies: GenerationDependencies = {},
): Promise<{ item: ContentItemDocument; changed: string[]; model: string }> => {
  const existing = await contentService.getItem(actor, input.itemId);
  const preferences = await resolvePreferences(actor, dependencies);

  const outcome = await generateStructured({
    brief: buildRegenerateBrief({
      item: existing,
      preferences,
      instruction: input.instruction,
      businessContext: input.businessContext,
    }),
    schema: regeneratedItemSchema,
    provider: dependencies.provider,
  });

  if (!outcome.ok) {
    throw generationFailed(outcome);
  }

  const fields = input.fields && input.fields.length > 0 ? input.fields : null;
  const wants = (field: NonNullable<RegenerateItemInput['fields']>[number]): boolean =>
    fields === null || fields.includes(field);

  const update: contentService.UpdateItemInput = {
    ...(wants('title') ? { title: outcome.data.title } : {}),
    ...(wants('idea') ? { idea: outcome.data.idea } : {}),
    ...(wants('caption') ? { caption: outcome.data.caption } : {}),
    ...(wants('callToAction') ? { callToAction: outcome.data.callToAction ?? null } : {}),
    ...(wants('hashtags') ? { hashtags: outcome.data.hashtags } : {}),
    // A rewritten item is a draft again: the copy is no longer the one that
    // was approved.
    ...(existing.status === 'ready' ? { status: 'draft' as const } : {}),
  };

  const item = await contentService.updateItem(actor, input.itemId, update);

  return { item, changed: Object.keys(update), model: outcome.model };
};

export interface AddGeneratedItemInput {
  planId: string;
  topic: string;
  date: Date;
  contentType?: ContentType | undefined;
  businessContext?: string | undefined;
}

/** Writes one new day into an existing plan, without touching the others. */
export const addGeneratedItem = async (
  actor: AuthenticatedUser,
  input: AddGeneratedItemInput,
  dependencies: GenerationDependencies = {},
): Promise<ContentItemDocument> => {
  const plan = await contentService.getPlan(actor, input.planId);
  const { caption } = await generateCaption(
    actor,
    {
      topic: input.topic,
      platform: plan.platform,
      contentType: input.contentType,
      businessContext: input.businessContext,
    },
    dependencies,
  );

  return contentService.addItem(actor, input.planId, {
    date: input.date,
    contentType: input.contentType ?? 'post',
    title: input.topic.slice(0, 200),
    idea: input.topic,
    caption: caption.caption,
    callToAction: caption.callToAction || null,
    hashtags: caption.hashtags,
    status: 'draft',
  });
};
