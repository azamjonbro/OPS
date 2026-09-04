import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as saleController from './sale.controller.js';
import {
  cancelSaleSchema,
  createSaleSchema,
  listSalesQuerySchema,
  saleIdParamSchema,
} from './sale.validators.js';

export const saleRouter: Router = Router();

saleRouter.post('/', ...validated({ body: createSaleSchema }, saleController.create));
saleRouter.get('/', ...validated({ query: listSalesQuerySchema }, saleController.list));
saleRouter.get('/:id', ...validated({ params: saleIdParamSchema }, saleController.detail));
/**
 * Cancelling is a state change on the receipt, not a deletion: the record and
 * its number survive, so `POST .../cancel` rather than `DELETE`.
 */
saleRouter.post(
  '/:id/cancel',
  ...validated({ params: saleIdParamSchema, body: cancelSaleSchema }, saleController.cancel),
);
