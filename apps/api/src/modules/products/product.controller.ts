import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as productService from './product.service.js';
import type {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
} from './product.validators.js';

export const create: ValidatedHandler<{ body: typeof createProductSchema }> = async (req, res) => {
  const product = await productService.createProduct(requireActor(req), req.validated.body);

  sendCreated(req, res, product);
};

export const list: ValidatedHandler<{ query: typeof listProductsQuerySchema }> = async (
  req,
  res,
) => {
  const result = await productService.listProducts(req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof productIdParamSchema }> = async (
  req,
  res,
) => {
  const product = await productService.getProduct(req.validated.params.id);

  sendSuccess(req, res, product);
};

export const update: ValidatedHandler<{
  params: typeof productIdParamSchema;
  body: typeof updateProductSchema;
}> = async (req, res) => {
  const product = await productService.updateProduct(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, product);
};

export const deactivate: ValidatedHandler<{ params: typeof productIdParamSchema }> = async (
  req,
  res,
) => {
  const product = await productService.deactivateProduct(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, product);
};
