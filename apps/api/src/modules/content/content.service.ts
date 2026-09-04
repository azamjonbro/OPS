import {
  buildPaginationMeta,
  CONTENT_PLAN_MAX_ITEMS,
  isObjectIdString,
  resolvePagination,
  type AuthenticatedUser,
  type ContentItemStatus,
  type ContentPlanStatus,
  type ContentPlatform,
  type ContentType,
  type PaginatedResult,
} from '@hadiya/shared';
import type { ClientSession } from 'mongoose';

import { toObjectId, toObjectIdOrNull } from '../../core/db/object-id.js';
import { runInTransaction } from '../../core/db/transaction.js';
import { ApiError } from '../../core/http/api-error.js';
import { ContentItemModel, type ContentItemDocument } from './content-item.model.js';
import { ContentPlanModel, type ContentPlanDocument } from './content-plan.model.js';

/**
 * Content plans and their items, scoped to one person.
 *
 * Every read and write filters on the actor's id — including item queries,
 * which is why `user` is denormalised onto the item. The filter *is* the
 * authorisation: a query that cannot match another account's row cannot leak
 * it, which is stronger than fetching a document and then deciding whether the
 * caller should have seen it. A stranger asking for a plan by id gets `404`,
 * not `403`, because a `403` would confirm the id exists.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

/** Midnight, so two items on the same day sort and compare as the same day. */
export const toDay = (value: Date): Date => {
  const day = new Date(value);

  day.setUTCHours(0, 0, 0, 0);

  return day;
};

export const addDays = (from: Date, days: number): Date =>
  new Date(from.getTime() + days * 86_400_000);

export interface ContentItemInput {
  date: Date;
  platform?: ContentPlatform | undefined;
  contentType: ContentType;
  title: string;
  idea: string;
  caption?: string | null | undefined;
  callToAction?: string | null | undefined;
  hashtags?: string[] | undefined;
  status?: ContentItemStatus | undefined;
  notes?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface CreatePlanInput {
  title: string;
  description?: string | null | undefined;
  platform: ContentPlatform;
  startDate: Date;
  endDate?: Date | undefined;
  status?: ContentPlanStatus | undefined;
  items?: ContentItemInput[] | undefined;
  conversationId?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

const assertItemCount = (count: number): void => {
  if (count > CONTENT_PLAN_MAX_ITEMS) {
    throw ApiError.badRequest(`A plan may hold at most ${CONTENT_PLAN_MAX_ITEMS} items`);
  }
};

/**
 * The end date a plan actually covers.
 *
 * Taken from the items when there are any, because a seven-day plan whose
 * `endDate` says three days is a plan that will stop showing its own content.
 */
const resolveEndDate = (input: CreatePlanInput): Date => {
  const itemDates = (input.items ?? []).map((item) => toDay(item.date).getTime());
  const latest = itemDates.length > 0 ? Math.max(...itemDates) : null;
  const stated = input.endDate ? toDay(input.endDate).getTime() : null;

  return new Date(Math.max(stated ?? 0, latest ?? 0, toDay(input.startDate).getTime()));
};

const buildItemDocument = (
  plan: ContentPlanDocument,
  actor: AuthenticatedUser,
  item: ContentItemInput,
) => ({
  plan: plan._id,
  user: toObjectId(actor.id),
  date: toDay(item.date),
  platform: item.platform ?? plan.platform,
  contentType: item.contentType,
  title: item.title.trim(),
  idea: item.idea.trim(),
  caption: item.caption?.trim() || null,
  callToAction: item.callToAction?.trim() || null,
  hashtags: item.hashtags ?? [],
  // An item with copy is a draft; one with only a topic is still an idea.
  status: item.status ?? (item.caption ? 'draft' : 'idea'),
  notes: item.notes?.trim() || null,
  metadata: item.metadata ?? {},
});

/**
 * Creates a plan and its items together.
 *
 * In one transaction where the deployment supports it: a plan whose items
 * failed halfway through is worse than no plan, because it looks complete in a
 * list and is wrong when opened.
 */
export const createPlan = async (
  actor: AuthenticatedUser,
  input: CreatePlanInput,
): Promise<ContentPlanDocument> => {
  const items = input.items ?? [];

  assertItemCount(items.length);

  const title = input.title.trim();

  if (title.length === 0) {
    throw ApiError.badRequest('A content plan needs a title');
  }

  return runInTransaction(async (session) => {
    const [created] = await ContentPlanModel.create(
      [
        {
          user: toObjectId(actor.id),
          title,
          description: input.description?.trim() || null,
          platform: input.platform,
          startDate: toDay(input.startDate),
          endDate: resolveEndDate(input),
          status: input.status ?? 'draft',
          itemCount: items.length,
          conversation: isObjectIdString(input.conversationId)
            ? toObjectIdOrNull(input.conversationId)
            : null,
          metadata: input.metadata ?? {},
        },
      ],
      session ? { session } : {},
    );

    if (!created) {
      throw ApiError.internal('The content plan could not be created');
    }

    if (items.length > 0) {
      await ContentItemModel.create(
        items.map((item) => buildItemDocument(created, actor, item)),
        session ? { session, ordered: true } : {},
      );
    }

    return created.toObject<ContentPlanDocument>();
  });
};

export interface ListPlansQuery {
  page: number;
  pageSize: number;
  status?: ContentPlanStatus | undefined;
  platform?: ContentPlatform | undefined;
  search?: string | undefined;
}

export const listPlans = async (
  actor: AuthenticatedUser,
  query: ListPlansQuery,
): Promise<PaginatedResult<ContentPlanDocument>> => {
  const filter: Record<string, unknown> = ownedBy(actor);

  if (query.status) {
    filter.status = query.status;
  }

  if (query.platform) {
    filter.platform = query.platform;
  }

  if (query.search) {
    filter.$or = [
      { title: { $regex: query.search, $options: 'i' } },
      { description: { $regex: query.search, $options: 'i' } },
    ];
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    ContentPlanModel.find(filter)
      .sort({ startDate: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ContentPlanDocument[]>()
      .exec(),
    ContentPlanModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const getPlan = async (
  actor: AuthenticatedUser,
  id: string,
  session?: ClientSession,
): Promise<ContentPlanDocument> => {
  const plan = await ContentPlanModel.findOne(ownedBy(actor, { _id: id }))
    .session(session ?? null)
    .lean<ContentPlanDocument | null>()
    .exec();

  if (!plan) {
    throw ApiError.notFound('Content plan not found');
  }

  return plan;
};

export const listPlanItems = async (
  actor: AuthenticatedUser,
  planId: string,
): Promise<ContentItemDocument[]> =>
  ContentItemModel.find(ownedBy(actor, { plan: planId }))
    .sort({ date: 1, createdAt: 1 })
    .lean<ContentItemDocument[]>()
    .exec();

export interface ContentPlanWithItems extends ContentPlanDocument {
  items: ContentItemDocument[];
}

/** A plan and its days, which is how every screen and every tool reads one. */
export const getPlanDetail = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ContentPlanWithItems> => {
  const plan = await getPlan(actor, id);

  return { ...plan, items: await listPlanItems(actor, id) };
};

export interface UpdatePlanInput {
  title?: string | undefined;
  description?: string | null | undefined;
  platform?: ContentPlatform | undefined;
  startDate?: Date | undefined;
  endDate?: Date | undefined;
  status?: ContentPlanStatus | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export const updatePlan = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdatePlanInput,
): Promise<ContentPlanDocument> => {
  const update: Record<string, unknown> = {};

  if (input.title !== undefined) {
    const title = input.title.trim();

    if (title.length === 0) {
      throw ApiError.badRequest('A content plan needs a title');
    }

    update.title = title;
  }

  if (input.description !== undefined) {
    update.description = input.description?.trim() || null;
  }

  if (input.platform !== undefined) {
    update.platform = input.platform;
  }

  if (input.startDate !== undefined) {
    update.startDate = toDay(input.startDate);
  }

  if (input.endDate !== undefined) {
    update.endDate = toDay(input.endDate);
  }

  if (input.status !== undefined) {
    update.status = input.status;
  }

  if (input.metadata !== undefined) {
    update.metadata = input.metadata;
  }

  if (Object.keys(update).length === 0) {
    return getPlan(actor, id);
  }

  const updated = await ContentPlanModel.findOneAndUpdate(
    ownedBy(actor, { _id: id }),
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ContentPlanDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Content plan not found');
  }

  return updated;
};

/**
 * Deletes a plan and everything in it.
 *
 * A real delete, not a status change: a plan is the user's own draft work, and
 * someone clearing out an old campaign means it to be gone. Items go with it in
 * the same transaction — orphaned items would still answer "what am I posting
 * today" from a plan that no longer exists.
 */
export const deletePlan = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<{ deletedPlan: number; deletedItems: number }> =>
  runInTransaction(async (session) => {
    const plan = await ContentPlanModel.findOneAndDelete(ownedBy(actor, { _id: id }))
      .session(session ?? null)
      .lean<ContentPlanDocument | null>()
      .exec();

    if (!plan) {
      throw ApiError.notFound('Content plan not found');
    }

    const items = await ContentItemModel.deleteMany(ownedBy(actor, { plan: id }))
      .session(session ?? null)
      .exec();

    return { deletedPlan: 1, deletedItems: items.deletedCount };
  });

/** Keeps the denormalised counter honest after items are added or removed. */
const syncItemCount = async (
  actor: AuthenticatedUser,
  planId: string,
  session?: ClientSession,
): Promise<void> => {
  const itemCount = await ContentItemModel.countDocuments(ownedBy(actor, { plan: planId }))
    .session(session ?? null)
    .exec();

  await ContentPlanModel.updateOne(ownedBy(actor, { _id: planId }), { $set: { itemCount } })
    .session(session ?? null)
    .exec();
};

export const addItem = async (
  actor: AuthenticatedUser,
  planId: string,
  input: ContentItemInput,
): Promise<ContentItemDocument> => {
  const plan = await getPlan(actor, planId);

  assertItemCount(plan.itemCount + 1);

  const created = await ContentItemModel.create(buildItemDocument(plan, actor, input));
  const item = created.toObject<ContentItemDocument>();

  await syncItemCount(actor, planId);

  // A day added outside the stated range widens the plan rather than being
  // silently dropped from every date-bounded read of it.
  if (item.date.getTime() > plan.endDate.getTime()) {
    await ContentPlanModel.updateOne(
      ownedBy(actor, { _id: planId }),
      { $set: { endDate: item.date } },
    ).exec();
  }

  return item;
};

export const getItem = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ContentItemDocument> => {
  const item = await ContentItemModel.findOne(ownedBy(actor, { _id: id }))
    .lean<ContentItemDocument | null>()
    .exec();

  if (!item) {
    throw ApiError.notFound('Content item not found');
  }

  return item;
};

export interface UpdateItemInput {
  date?: Date | undefined;
  platform?: ContentPlatform | undefined;
  contentType?: ContentType | undefined;
  title?: string | undefined;
  idea?: string | undefined;
  caption?: string | null | undefined;
  callToAction?: string | null | undefined;
  hashtags?: string[] | undefined;
  status?: ContentItemStatus | undefined;
  notes?: string | null | undefined;
  metadata?: Record<string, unknown> | undefined;
}

/**
 * Changes one item, and only the fields named.
 *
 * This is what makes "captionni qisqartir" a one-field write: an absent field
 * is left alone rather than overwritten with a default, so a targeted edit
 * cannot quietly erase the idea or the hashtags somebody already approved.
 */
export const updateItem = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateItemInput,
): Promise<ContentItemDocument> => {
  const update: Record<string, unknown> = {};

  if (input.date !== undefined) {
    update.date = toDay(input.date);
  }

  if (input.platform !== undefined) {
    update.platform = input.platform;
  }

  if (input.contentType !== undefined) {
    update.contentType = input.contentType;
  }

  if (input.title !== undefined) {
    const title = input.title.trim();

    if (title.length === 0) {
      throw ApiError.badRequest('A content item needs a title');
    }

    update.title = title;
  }

  if (input.idea !== undefined) {
    update.idea = input.idea.trim();
  }

  if (input.caption !== undefined) {
    update.caption = input.caption?.trim() || null;
  }

  if (input.callToAction !== undefined) {
    update.callToAction = input.callToAction?.trim() || null;
  }

  if (input.hashtags !== undefined) {
    update.hashtags = input.hashtags;
  }

  if (input.status !== undefined) {
    update.status = input.status;
  }

  if (input.notes !== undefined) {
    update.notes = input.notes?.trim() || null;
  }

  if (input.metadata !== undefined) {
    update.metadata = input.metadata;
  }

  if (Object.keys(update).length === 0) {
    return getItem(actor, id);
  }

  const updated = await ContentItemModel.findOneAndUpdate(
    ownedBy(actor, { _id: id }),
    { $set: update },
    { returnDocument: 'after', runValidators: true },
  )
    .lean<ContentItemDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Content item not found');
  }

  return updated;
};

export const deleteItem = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<{ deleted: number; planId: string }> => {
  const item = await ContentItemModel.findOneAndDelete(ownedBy(actor, { _id: id }))
    .lean<ContentItemDocument | null>()
    .exec();

  if (!item) {
    throw ApiError.notFound('Content item not found');
  }

  const planId = String(item.plan);

  await syncItemCount(actor, planId);

  return { deleted: 1, planId };
};

export interface ListItemsQuery {
  page: number;
  pageSize: number;
  planId?: string | undefined;
  status?: ContentItemStatus | undefined;
  platform?: ContentPlatform | undefined;
  contentType?: ContentType | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

/** Items across every plan the user owns — the calendar view of the engine. */
export const listItems = async (
  actor: AuthenticatedUser,
  query: ListItemsQuery,
): Promise<PaginatedResult<ContentItemDocument>> => {
  const filter: Record<string, unknown> = ownedBy(actor);

  if (query.planId) {
    filter.plan = query.planId;
  }

  if (query.status) {
    filter.status = query.status;
  }

  if (query.platform) {
    filter.platform = query.platform;
  }

  if (query.contentType) {
    filter.contentType = query.contentType;
  }

  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: toDay(query.from) } : {}),
      ...(query.to ? { $lte: toDay(query.to) } : {}),
    };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    ContentItemModel.find(filter)
      .sort({ date: 1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean<ContentItemDocument[]>()
      .exec(),
    ContentItemModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};
