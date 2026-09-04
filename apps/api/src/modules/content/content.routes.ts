import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as contentController from './content.controller.js';
import {
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

/**
 * A person's own content. Every query in the service is scoped to the actor, so
 * no role check applies and none would help: nothing here belongs to anyone
 * else, and an owner may always manage their own.
 *
 * Plans and items are separate resources rather than one nested tree, because
 * the item edits are the frequent ones and a client should be able to patch a
 * single day without naming its plan.
 */
export const contentRouter: Router = Router();

/* Plans. */
contentRouter.post('/plans', ...validated({ body: createContentPlanSchema }, contentController.createPlan));
contentRouter.get(
  '/plans',
  ...validated({ query: listContentPlansQuerySchema }, contentController.listPlans),
);
/** Literal paths are declared before `/:id` so they win the match. */
contentRouter.post(
  '/plans/generate',
  ...validated({ body: generateContentPlanSchema }, contentController.generatePlan),
);
contentRouter.get(
  '/plans/:id',
  ...validated({ params: contentPlanIdParamSchema }, contentController.planDetail),
);
contentRouter.patch(
  '/plans/:id',
  ...validated(
    { params: contentPlanIdParamSchema, body: updateContentPlanSchema },
    contentController.updatePlan,
  ),
);
contentRouter.delete(
  '/plans/:id',
  ...validated({ params: contentPlanIdParamSchema }, contentController.deletePlan),
);
contentRouter.post(
  '/plans/:id/items',
  ...validated(
    { params: contentPlanIdParamSchema, body: contentItemInputSchema },
    contentController.addItem,
  ),
);

/* Items. */
contentRouter.get(
  '/items',
  ...validated({ query: listContentItemsQuerySchema }, contentController.listItems),
);
contentRouter.get(
  '/items/:id',
  ...validated({ params: contentItemIdParamSchema }, contentController.itemDetail),
);
contentRouter.patch(
  '/items/:id',
  ...validated(
    { params: contentItemIdParamSchema, body: updateContentItemSchema },
    contentController.updateItem,
  ),
);
contentRouter.delete(
  '/items/:id',
  ...validated({ params: contentItemIdParamSchema }, contentController.deleteItem),
);
contentRouter.post(
  '/items/:id/regenerate',
  ...validated(
    { params: contentItemIdParamSchema, body: regenerateContentItemSchema },
    contentController.regenerateItem,
  ),
);

/* Generation that produces copy without storing a plan. */
contentRouter.post(
  '/captions',
  ...validated({ body: generateCaptionSchema }, contentController.generateCaption),
);
