import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as categoryController from './category.controller.js';
import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './category.validators.js';

export const categoryRouter: Router = Router();

categoryRouter.post('/', ...validated({ body: createCategorySchema }, categoryController.create));
categoryRouter.get(
  '/',
  ...validated({ query: listCategoriesQuerySchema }, categoryController.list),
);
categoryRouter.get(
  '/:id',
  ...validated({ params: categoryIdParamSchema }, categoryController.detail),
);
categoryRouter.patch(
  '/:id',
  ...validated(
    { params: categoryIdParamSchema, body: updateCategorySchema },
    categoryController.update,
  ),
);
categoryRouter.delete(
  '/:id',
  ...validated({ params: categoryIdParamSchema }, categoryController.deactivate),
);
