import {
  sendCreated,
  sendPaginated,
  sendSuccess,
} from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as generationService from './content-generation.service.js';
import * as contentService from './content.service.js';
import type {
  contentItemIdParamSchema,
  contentItemInputSchema,
  contentPlanIdParamSchema,
  createContentPlanSchema,
  generateCaptionSchema,
  generateContentPlanSchema,
  listContentItemsQuerySchema,
  listContentPlansQuerySchema,
  regenerateContentItemSchema,
  updateContentItemSchema,
  updateContentPlanSchema,
} from './content.validators.js';

export const createPlan: ValidatedHandler<{ body: typeof createContentPlanSchema }> = async (
  req,
  res,
) => {
  const plan = await contentService.createPlan(requireActor(req), req.validated.body);

  sendCreated(req, res, plan);
};

export const listPlans: ValidatedHandler<{ query: typeof listContentPlansQuerySchema }> = async (
  req,
  res,
) => {
  const result = await contentService.listPlans(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

/** A plan always comes back with its days: nothing useful can be done without them. */
export const planDetail: ValidatedHandler<{ params: typeof contentPlanIdParamSchema }> = async (
  req,
  res,
) => {
  const plan = await contentService.getPlanDetail(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, plan);
};

export const updatePlan: ValidatedHandler<{
  params: typeof contentPlanIdParamSchema;
  body: typeof updateContentPlanSchema;
}> = async (req, res) => {
  const plan = await contentService.updatePlan(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, plan);
};

export const deletePlan: ValidatedHandler<{ params: typeof contentPlanIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await contentService.deletePlan(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, result);
};

export const addItem: ValidatedHandler<{
  params: typeof contentPlanIdParamSchema;
  body: typeof contentItemInputSchema;
}> = async (req, res) => {
  const item = await contentService.addItem(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendCreated(req, res, item);
};

export const listItems: ValidatedHandler<{ query: typeof listContentItemsQuerySchema }> = async (
  req,
  res,
) => {
  const result = await contentService.listItems(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const itemDetail: ValidatedHandler<{ params: typeof contentItemIdParamSchema }> = async (
  req,
  res,
) => {
  const item = await contentService.getItem(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, item);
};

export const updateItem: ValidatedHandler<{
  params: typeof contentItemIdParamSchema;
  body: typeof updateContentItemSchema;
}> = async (req, res) => {
  const item = await contentService.updateItem(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, item);
};

export const deleteItem: ValidatedHandler<{ params: typeof contentItemIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await contentService.deleteItem(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, result);
};

/**
 * Generation over REST, for a client that wants a plan without a conversation.
 * The same service the assistant's tools call, so both paths validate the
 * model's output identically.
 */
export const generatePlan: ValidatedHandler<{ body: typeof generateContentPlanSchema }> = async (
  req,
  res,
) => {
  const result = await generationService.generatePlan(requireActor(req), req.validated.body);

  sendCreated(req, res, {
    plan: result.plan,
    items: result.items,
    appliedPreferences: result.preferences,
    model: result.model,
  });
};

export const generateCaption: ValidatedHandler<{ body: typeof generateCaptionSchema }> = async (
  req,
  res,
) => {
  const result = await generationService.generateCaption(requireActor(req), req.validated.body);

  sendSuccess(req, res, {
    ...result.caption,
    appliedPreferences: result.preferences,
    model: result.model,
  });
};

export const regenerateItem: ValidatedHandler<{
  params: typeof contentItemIdParamSchema;
  body: typeof regenerateContentItemSchema;
}> = async (req, res) => {
  const result = await generationService.regenerateItem(requireActor(req), {
    itemId: req.validated.params.id,
    ...req.validated.body,
  });

  sendSuccess(req, res, { item: result.item, changed: result.changed, model: result.model });
};
