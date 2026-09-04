import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as categoryService from './category.service.js';
import type {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './category.validators.js';

export const create: ValidatedHandler<{ body: typeof createCategorySchema }> = async (req, res) => {
  const category = await categoryService.createCategory(requireActor(req), req.validated.body);

  sendCreated(req, res, category);
};

export const list: ValidatedHandler<{ query: typeof listCategoriesQuerySchema }> = async (
  req,
  res,
) => {
  const result = await categoryService.listCategories(req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof categoryIdParamSchema }> = async (
  req,
  res,
) => {
  const category = await categoryService.getCategory(req.validated.params.id);

  sendSuccess(req, res, category);
};

export const update: ValidatedHandler<{
  params: typeof categoryIdParamSchema;
  body: typeof updateCategorySchema;
}> = async (req, res) => {
  const category = await categoryService.updateCategory(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, category);
};

export const deactivate: ValidatedHandler<{ params: typeof categoryIdParamSchema }> = async (
  req,
  res,
) => {
  const category = await categoryService.deactivateCategory(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, category);
};
