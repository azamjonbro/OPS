import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as productController from './product.controller.js';
import {
  createProductSchema,
  listProductsQuerySchema,
  productIdParamSchema,
  updateProductSchema,
} from './product.validators.js';

export const productRouter: Router = Router();

productRouter.post('/', ...validated({ body: createProductSchema }, productController.create));
productRouter.get('/', ...validated({ query: listProductsQuerySchema }, productController.list));
productRouter.get('/:id', ...validated({ params: productIdParamSchema }, productController.detail));
productRouter.patch(
  '/:id',
  ...validated(
    { params: productIdParamSchema, body: updateProductSchema },
    productController.update,
  ),
);
productRouter.delete(
  '/:id',
  ...validated({ params: productIdParamSchema }, productController.deactivate),
);
