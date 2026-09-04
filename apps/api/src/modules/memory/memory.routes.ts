import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as memoryController from './memory.controller.js';
import {
  createMemorySchema,
  forgetMemoryQuerySchema,
  listMemoriesQuerySchema,
  memoryIdParamSchema,
  updateMemorySchema,
} from './memory.validators.js';

/**
 * A person's own memory. Like conversations, every query is scoped to the
 * actor, so no role check is needed and none would help: there is nothing here
 * that belongs to anyone else.
 */
export const memoryRouter: Router = Router();

memoryRouter.post('/', ...validated({ body: createMemorySchema }, memoryController.create));
memoryRouter.get('/', ...validated({ query: listMemoriesQuerySchema }, memoryController.list));
/** Forgetting by key comes before `/:id` so the literal path wins the match. */
memoryRouter.delete(
  '/by-key',
  ...validated({ query: forgetMemoryQuerySchema }, memoryController.forgetByKey),
);
memoryRouter.get('/:id', ...validated({ params: memoryIdParamSchema }, memoryController.detail));
memoryRouter.patch(
  '/:id',
  ...validated({ params: memoryIdParamSchema, body: updateMemorySchema }, memoryController.update),
);
memoryRouter.post(
  '/:id/confirm',
  ...validated({ params: memoryIdParamSchema }, memoryController.confirm),
);
memoryRouter.delete(
  '/:id',
  ...validated({ params: memoryIdParamSchema }, memoryController.forgetById),
);
