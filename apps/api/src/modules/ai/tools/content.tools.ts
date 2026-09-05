import {
  CONTENT_IDEAS_DEFAULT,
  CONTENT_IDEAS_MAX,
  CONTENT_ITEM_STATUSES,
  CONTENT_PLAN_MAX_DAYS,
  CONTENT_PLAN_STATUSES,
  CONTENT_PLATFORMS,
  CONTENT_TYPES,
  type ContentItemStatus,
  type ContentPlanStatus,
  type ContentPlatform,
  type ContentType,
} from '@hadiya/shared';
import { z } from 'zod';

import type { ContentItemDocument } from '../../content/content-item.model.js';
import type { ContentPlanDocument } from '../../content/content-plan.model.js';
import * as generationService from '../../content/content-generation.service.js';
import * as contentService from '../../content/content.service.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * The content tools the assistant is allowed to call.
 *
 * They are the only route from a conversation to a stored plan, and each is
 * narrow on purpose. The model describes *what* is wanted; it never chooses a
 * user, never writes a document directly, and never decides that something can
 * be deleted. The actor comes from the authenticated request, so a tool cannot
 * be talked into acting as another employee, and every call runs through the
 * same service the REST API uses — which is what makes "your plans are yours"
 * one rule rather than two implementations of it.
 *
 * Two of them generate: `create_content_plan` when asked to, and the caption,
 * ideas and regenerate tools always. Generation is a second, structured model
 * call inside the tool rather than something the conversational model writes
 * itself, because the output has to satisfy a schema before it is stored, and a
 * tool argument the model improvised is exactly the thing that would not.
 *
 * Business facts are never read here. When a plan should be based on what is
 * selling, the assistant calls `billz_get_sales_summary` or `billz_get_products` first and
 * passes what it found as `businessContext` — so the data in a plan is data
 * somebody asked for.
 */

const platformSchema = z
  .enum(CONTENT_PLATFORMS)
  .describe('Where it will be posted. Defaults to the user’s preferred platform.');

const contentTypeSchema = z.enum(CONTENT_TYPES);

const businessContextSchema = z
  .string()
  .trim()
  .max(4_000)
  .optional()
  .describe(
    'Real figures or product details you gathered with billz_get_sales_summary or billz_get_products. Never invent this.',
  );

const objectIdArgument = (what: string) =>
  z.string().trim().length(24).describe(`The ${what}'s id, from a list tool`);

/** `YYYY-MM-DD`; the model is given today's date in its instructions. */
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe('ISO date, e.g. 2026-09-06');

const toDate = (value: string): Date => {
  const parsed = new Date(`${value}T00:00:00.000Z`);

  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`"${value}" is not a date I can read; use YYYY-MM-DD.`);
  }

  return parsed;
};

const describePlan = (plan: ContentPlanDocument): string =>
  `${plan.title} — ${plan.platform}, ${plan.itemCount} item(s), ${plan.startDate
    .toISOString()
    .slice(0, 10)} to ${plan.endDate.toISOString().slice(0, 10)} [${plan.status}, id ${String(
    plan._id,
  )}]`;

const summarisePlan = (plan: ContentPlanDocument) => ({
  id: String(plan._id),
  title: plan.title,
  platform: plan.platform,
  status: plan.status,
  startDate: plan.startDate.toISOString().slice(0, 10),
  endDate: plan.endDate.toISOString().slice(0, 10),
  itemCount: plan.itemCount,
});

const describeItem = (item: ContentItemDocument): string =>
  `${item.date.toISOString().slice(0, 10)} · ${item.contentType} · ${item.title}${
    item.caption ? ` — "${item.caption.slice(0, 120)}${item.caption.length > 120 ? '…' : ''}"` : ''
  } [${item.status}, id ${String(item._id)}]`;

const summariseItem = (item: ContentItemDocument) => ({
  id: String(item._id),
  planId: String(item.plan),
  date: item.date.toISOString().slice(0, 10),
  platform: item.platform,
  contentType: item.contentType,
  title: item.title,
  idea: item.idea,
  caption: item.caption,
  callToAction: item.callToAction,
  hashtags: item.hashtags,
  status: item.status,
});

/* -------------------------------------------------------------------------- */
/* Plans                                                                      */
/* -------------------------------------------------------------------------- */

export const createContentPlanTool: RegisteredTool = {
  name: 'create_content_plan',
  category: 'content',
  description:
    'Create and save a content plan. Give a brief and how many days it covers and the plan is written for you, validated and stored — this is what to call for "7 kunlik Instagram plan tuz". If the user dictated the exact days themselves, pass them as `items` instead and nothing is generated. Base a plan on real figures by calling billz_get_sales_summary or billz_get_products first and passing what you found as businessContext.',
  mutates: true,
  schema: z.object({
    brief: z
      .string()
      .trim()
      .min(3)
      .max(1_000)
      .describe('What the plan is for, in the user’s own words'),
    title: z.string().trim().min(1).max(160).optional().describe('Defaults to a generated title'),
    platform: platformSchema.optional(),
    days: z
      .number()
      .int()
      .min(1)
      .max(CONTENT_PLAN_MAX_DAYS)
      .default(7)
      .describe('How many days the plan covers'),
    startDate: dateSchema.optional().describe('Defaults to today'),
    contentTypes: z
      .array(contentTypeSchema)
      .max(CONTENT_TYPES.length)
      .optional()
      .describe('Only when the user asked for specific formats'),
    businessContext: businessContextSchema,
    items: z
      .array(
        z.object({
          date: dateSchema,
          contentType: contentTypeSchema,
          title: z.string().trim().min(1).max(200),
          idea: z.string().trim().min(1).max(2_000),
          caption: z.string().trim().max(4_000).optional(),
          callToAction: z.string().trim().max(300).optional(),
          hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
        }),
      )
      .max(60)
      .optional()
      .describe('Only when the user gave you the exact days. Otherwise leave this out.'),
  }),
  execute: async (args, context) => {
    const input = args as {
      brief: string;
      title?: string;
      platform?: ContentPlatform;
      days: number;
      startDate?: string;
      contentTypes?: ContentType[];
      businessContext?: string;
      items?: Array<{
        date: string;
        contentType: ContentType;
        title: string;
        idea: string;
        caption?: string;
        callToAction?: string;
        hashtags?: string[];
      }>;
    };

    // The user dictated the days: store exactly those, generate nothing.
    if (input.items && input.items.length > 0) {
      const items = input.items.map((item) => ({
        date: toDate(item.date),
        contentType: item.contentType,
        title: item.title,
        idea: item.idea,
        caption: item.caption ?? null,
        callToAction: item.callToAction ?? null,
        hashtags: item.hashtags ?? [],
      }));
      const startDate = items.reduce(
        (earliest, item) => (item.date < earliest ? item.date : earliest),
        items[0]?.date ?? new Date(),
      );

      const plan = await contentService.createPlan(context.actor, {
        title: input.title ?? input.brief.slice(0, 160),
        description: input.brief,
        platform: input.platform ?? 'instagram',
        startDate,
        items,
        conversationId: context.conversationId,
        metadata: { brief: input.brief, source: 'user_dictated' },
      });

      return {
        summary: `Saved: ${describePlan(plan)}`,
        data: { ...summarisePlan(plan), items: items.length },
      };
    }

    const result = await generationService.generatePlan(context.actor, {
      brief: input.brief,
      platform: input.platform,
      days: input.days,
      ...(input.startDate ? { startDate: toDate(input.startDate) } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.contentTypes ? { contentTypes: input.contentTypes } : {}),
      ...(input.businessContext ? { businessContext: input.businessContext } : {}),
      conversationId: context.conversationId,
    });

    if (!result.plan) {
      throw new Error('The plan was generated but not saved');
    }

    return {
      summary: [
        `Saved a ${result.items.length}-day plan: ${describePlan(result.plan)}.`,
        `Days: ${result.items
          .map((item, index) => `${index + 1}) ${item.contentType} — ${item.title}`)
          .join('; ')}`,
      ].join(' '),
      data: {
        ...summarisePlan(result.plan),
        items: result.items.map((item, index) => ({
          day: index + 1,
          date: item.date.toISOString().slice(0, 10),
          contentType: item.contentType,
          title: item.title,
          idea: item.idea,
          caption: item.caption,
          callToAction: item.callToAction,
          hashtags: item.hashtags,
        })),
        appliedPreferences: result.preferences,
      },
    };
  },
};

export const listContentPlansTool: RegisteredTool = {
  name: 'list_content_plans',
  category: 'content',
  description:
    'The user’s own content plans, newest first. Use it to find the plan they mean before changing or deleting one.',
  mutates: false,
  schema: z.object({
    status: z.enum(CONTENT_PLAN_STATUSES).optional(),
    platform: z.enum(CONTENT_PLATFORMS).optional(),
    search: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe('Matches the title or description'),
    limit: z.number().int().min(1).max(50).default(10),
  }),
  execute: async (args, context) => {
    const { status, platform, search, limit } = args as {
      status?: ContentPlanStatus;
      platform?: ContentPlatform;
      search?: string;
      limit: number;
    };

    const { items, pagination } = await contentService.listPlans(context.actor, {
      page: 1,
      pageSize: limit,
      ...(status ? { status } : {}),
      ...(platform ? { platform } : {}),
      ...(search ? { search } : {}),
    });

    if (items.length === 0) {
      return { summary: 'There are no content plans yet.', data: { items: [], total: 0 } };
    }

    return {
      summary: `${pagination.total} plan(s): ${items.map(describePlan).join(' | ')}`,
      data: { items: items.map(summarisePlan), total: pagination.total },
    };
  },
};

export const getContentPlanTool: RegisteredTool = {
  name: 'get_content_plan',
  category: 'content',
  description:
    'One plan with every day in it. Call this before editing a specific day, so you have the item ids.',
  mutates: false,
  schema: z.object({ planId: objectIdArgument('plan') }),
  execute: async (args, context) => {
    const { planId } = args as { planId: string };
    const plan = await contentService.getPlanDetail(context.actor, planId);

    return {
      summary: [
        describePlan(plan),
        plan.items.length > 0
          ? `Days: ${plan.items.map(describeItem).join(' | ')}`
          : 'No days yet.',
      ].join(' '),
      data: { ...summarisePlan(plan), items: plan.items.map(summariseItem) },
    };
  },
};

export const updateContentPlanTool: RegisteredTool = {
  name: 'update_content_plan',
  category: 'content',
  description:
    'Change a plan’s own details — its title, description, platform or status. This does not touch the days inside it; use update_content_item for those.',
  mutates: true,
  schema: z.object({
    planId: objectIdArgument('plan'),
    title: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2_000).optional(),
    platform: platformSchema.optional(),
    status: z.enum(CONTENT_PLAN_STATUSES).optional(),
    startDate: dateSchema.optional(),
  }),
  execute: async (args, context) => {
    const input = args as {
      planId: string;
      title?: string;
      description?: string;
      platform?: ContentPlatform;
      status?: ContentPlanStatus;
      startDate?: string;
    };

    const plan = await contentService.updatePlan(context.actor, input.planId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.platform !== undefined ? { platform: input.platform } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.startDate !== undefined ? { startDate: toDate(input.startDate) } : {}),
    });

    return { summary: `Updated: ${describePlan(plan)}`, data: summarisePlan(plan) };
  },
};

export const deleteContentPlanTool: RegisteredTool = {
  name: 'delete_content_plan',
  category: 'content',
  description:
    'Delete a content plan and every day in it. This cannot be undone, so the user has to agree first: call it once to see what would go, tell them, and call it again with confirm: true only after they say yes.',
  mutates: true,
  // Enforced by the registry, not by this tool, so the guard cannot be skipped.
  requiresConfirmation: true,
  schema: z.object({
    planId: objectIdArgument('plan'),
    confirm: z
      .boolean()
      .default(false)
      .describe('True only after the user has explicitly agreed to the deletion'),
  }),
  describeConfirmation: async (args, context) => {
    const { planId } = args as { planId: string };
    // Read before describing, so the person is told what would actually go
    // rather than what the model believed it had selected.
    const plan = await contentService.getPlan(context.actor, planId);

    return `permanently delete the plan "${plan.title}" and its ${plan.itemCount} item(s)`;
  },
  execute: async (args, context) => {
    const { planId } = args as { planId: string };
    const plan = await contentService.getPlan(context.actor, planId);
    const result = await contentService.deletePlan(context.actor, planId);

    return {
      summary: `Deleted "${plan.title}" and ${result.deletedItems} item(s).`,
      data: { deleted: true, planId, ...result },
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Items                                                                      */
/* -------------------------------------------------------------------------- */

export const createContentItemTool: RegisteredTool = {
  name: 'create_content_item',
  category: 'content',
  // An item lives inside a plan. When a round asks for both, the item does not
  // run against a plan that was never made: there is no invented id standing in
  // for one. Across rounds this does nothing, because by then the model has the
  // real id in front of it.
  dependsOn: ['create_content_plan'],
  description:
    'Add one day to an existing plan. Give the caption yourself if the user dictated it; leave it out and describe the topic instead, and the copy is written and validated for you.',
  mutates: true,
  schema: z.object({
    planId: objectIdArgument('plan'),
    date: dateSchema,
    contentType: contentTypeSchema.default('post'),
    title: z.string().trim().min(1).max(200).describe('A short name for the post'),
    idea: z.string().trim().min(1).max(2_000).describe('What the post is about'),
    caption: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .describe('Leave this out to have the caption written for you'),
    callToAction: z.string().trim().max(300).optional(),
    hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    businessContext: businessContextSchema,
  }),
  execute: async (args, context) => {
    const input = args as {
      planId: string;
      date: string;
      contentType: ContentType;
      title: string;
      idea: string;
      caption?: string;
      callToAction?: string;
      hashtags?: string[];
      businessContext?: string;
    };

    if (!input.caption) {
      const item = await generationService.addGeneratedItem(context.actor, {
        planId: input.planId,
        topic: input.idea,
        date: toDate(input.date),
        contentType: input.contentType,
        ...(input.businessContext ? { businessContext: input.businessContext } : {}),
      });

      // The generator titles the item from the topic; the user's own title wins.
      const titled = await contentService.updateItem(context.actor, String(item._id), {
        title: input.title,
        idea: input.idea,
      });

      return { summary: `Added: ${describeItem(titled)}`, data: summariseItem(titled) };
    }

    const item = await contentService.addItem(context.actor, input.planId, {
      date: toDate(input.date),
      contentType: input.contentType,
      title: input.title,
      idea: input.idea,
      caption: input.caption,
      callToAction: input.callToAction ?? null,
      hashtags: input.hashtags ?? [],
    });

    return { summary: `Added: ${describeItem(item)}`, data: summariseItem(item) };
  },
};

export const updateContentItemTool: RegisteredTool = {
  name: 'update_content_item',
  category: 'content',
  description:
    'Change one day of a plan. Only send the fields that change — anything you leave out keeps the value it already had, so this is how to edit a caption without losing the idea or the hashtags. Use it when the user dictated the new wording; use regenerate_content_item when they want you to write it.',
  mutates: true,
  schema: z.object({
    itemId: objectIdArgument('item'),
    date: dateSchema.optional(),
    contentType: contentTypeSchema.optional(),
    title: z.string().trim().min(1).max(200).optional(),
    idea: z.string().trim().min(1).max(2_000).optional(),
    caption: z.string().trim().max(4_000).optional(),
    callToAction: z.string().trim().max(300).optional(),
    hashtags: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
    status: z.enum(CONTENT_ITEM_STATUSES).optional(),
    notes: z.string().trim().max(2_000).optional(),
  }),
  execute: async (args, context) => {
    const input = args as {
      itemId: string;
      date?: string;
      contentType?: ContentType;
      title?: string;
      idea?: string;
      caption?: string;
      callToAction?: string;
      hashtags?: string[];
      status?: ContentItemStatus;
      notes?: string;
    };

    const item = await contentService.updateItem(context.actor, input.itemId, {
      ...(input.date !== undefined ? { date: toDate(input.date) } : {}),
      ...(input.contentType !== undefined ? { contentType: input.contentType } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.idea !== undefined ? { idea: input.idea } : {}),
      ...(input.caption !== undefined ? { caption: input.caption } : {}),
      ...(input.callToAction !== undefined ? { callToAction: input.callToAction } : {}),
      ...(input.hashtags !== undefined ? { hashtags: input.hashtags } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    });

    return { summary: `Updated: ${describeItem(item)}`, data: summariseItem(item) };
  },
};

export const deleteContentItemTool: RegisteredTool = {
  name: 'delete_content_item',
  category: 'content',
  description:
    'Remove one day from a plan. It cannot be undone, so ask the user first: call it once to see what would go, tell them, and call again with confirm: true after they agree.',
  mutates: true,
  requiresConfirmation: true,
  schema: z.object({
    itemId: objectIdArgument('item'),
    confirm: z
      .boolean()
      .default(false)
      .describe('True only after the user has explicitly agreed to the deletion'),
  }),
  describeConfirmation: async (args, context) => {
    const { itemId } = args as { itemId: string };
    const item = await contentService.getItem(context.actor, itemId);

    return `permanently delete "${item.title}" on ${item.date.toISOString().slice(0, 10)}`;
  },
  execute: async (args, context) => {
    const { itemId } = args as { itemId: string };
    const item = await contentService.getItem(context.actor, itemId);
    const result = await contentService.deleteItem(context.actor, itemId);

    return {
      summary: `Deleted "${item.title}".`,
      data: { deleted: result.deleted, itemId, planId: result.planId },
    };
  },
};

export const regenerateContentItemTool: RegisteredTool = {
  name: 'regenerate_content_item',
  category: 'content',
  description:
    'Rewrite one day of a plan. This is what to call for "captionni qisqartir", "ko\'proq professional qil" or "hashtaglarni yangila". Name the fields to change and everything else is kept exactly as it is, so an approved idea is not lost when only the copy was wrong.',
  mutates: true,
  schema: z.object({
    itemId: objectIdArgument('item'),
    instruction: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe('What to change, in the user’s own words. Leave out to simply improve it.'),
    fields: z
      .array(z.enum(['caption', 'hashtags', 'idea', 'title', 'callToAction']))
      .max(5)
      .optional()
      .describe('Which parts to rewrite. Leave out to rewrite the whole item.'),
    businessContext: businessContextSchema,
  }),
  execute: async (args, context) => {
    const input = args as {
      itemId: string;
      instruction?: string;
      fields?: Array<'caption' | 'hashtags' | 'idea' | 'title' | 'callToAction'>;
      businessContext?: string;
    };

    const result = await generationService.regenerateItem(context.actor, {
      itemId: input.itemId,
      ...(input.instruction ? { instruction: input.instruction } : {}),
      ...(input.fields ? { fields: input.fields } : {}),
      ...(input.businessContext ? { businessContext: input.businessContext } : {}),
    });

    return {
      summary: `Rewritten (${result.changed.join(', ')}): ${describeItem(result.item)}`,
      data: { ...summariseItem(result.item), changed: result.changed },
    };
  },
};

/* -------------------------------------------------------------------------- */
/* Generation that stores nothing                                             */
/* -------------------------------------------------------------------------- */

export const generateCaptionTool: RegisteredTool = {
  name: 'generate_caption',
  category: 'content',
  description:
    'Write a caption for a post without saving anything. Use it for "bugungi post uchun caption yoz", or to rework a caption the user pasted in. It follows the user’s stored language, tone and style.',
  // Nothing is written; the user decides afterwards whether to keep it.
  mutates: false,
  schema: z.object({
    topic: z.string().trim().min(3).max(1_000).describe('What the post is about'),
    platform: platformSchema.optional(),
    contentType: contentTypeSchema.optional(),
    existingCaption: z
      .string()
      .trim()
      .max(4_000)
      .optional()
      .describe('The caption to rework, when the user gave you one'),
    instruction: z
      .string()
      .trim()
      .max(500)
      .optional()
      .describe('What to change about it, e.g. "shorter", "more professional"'),
    businessContext: businessContextSchema,
  }),
  execute: async (args, context) => {
    const input = args as {
      topic: string;
      platform?: ContentPlatform;
      contentType?: ContentType;
      existingCaption?: string;
      instruction?: string;
      businessContext?: string;
    };

    const { caption, preferences } = await generationService.generateCaption(context.actor, input);

    return {
      summary: [
        caption.caption,
        caption.callToAction ? `CTA: ${caption.callToAction}` : '',
        caption.hashtags.length > 0
          ? `Hashtags: ${caption.hashtags.map((tag) => `#${tag}`).join(' ')}`
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      data: { ...caption, appliedPreferences: preferences },
    };
  },
};

export const generateContentIdeasTool: RegisteredTool = {
  name: 'generate_content_ideas',
  category: 'content',
  description:
    'Suggest content ideas without saving anything — "Ramazon uchun 10 ta content idea ber". Each idea comes back with an angle and hashtags, so the user can pick one and you can then add it to a plan.',
  mutates: false,
  schema: z.object({
    topic: z.string().trim().min(3).max(1_000).describe('What the ideas should be about'),
    platform: platformSchema.optional(),
    count: z.number().int().min(1).max(CONTENT_IDEAS_MAX).default(CONTENT_IDEAS_DEFAULT),
    businessContext: businessContextSchema,
  }),
  execute: async (args, context) => {
    const input = args as {
      topic: string;
      platform?: ContentPlatform;
      count: number;
      businessContext?: string;
    };

    const { ideas } = await generationService.generateIdeas(context.actor, input);

    return {
      summary: ideas
        .map((idea, index) => `${index + 1}. ${idea.title} (${idea.contentType}) — ${idea.angle}`)
        .join('\n'),
      data: { ideas },
    };
  },
};

export const CONTENT_TOOLS: readonly RegisteredTool[] = [
  createContentPlanTool,
  listContentPlansTool,
  getContentPlanTool,
  updateContentPlanTool,
  deleteContentPlanTool,
  createContentItemTool,
  updateContentItemTool,
  deleteContentItemTool,
  regenerateContentItemTool,
  generateCaptionTool,
  generateContentIdeasTool,
];
