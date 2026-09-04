import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as inventoryController from './inventory.controller.js';
import {
  listMovementsQuerySchema,
  listStockQuerySchema,
  recordMovementSchema,
  transferStockSchema,
} from './inventory.validators.js';

export const inventoryRouter: Router = Router();

/** Current stock levels, lowest first. */
inventoryRouter.get(
  '/',
  ...validated({ query: listStockQuerySchema }, inventoryController.listStock),
);
/** The audit trail: every movement that produced those levels. */
inventoryRouter.get(
  '/movements',
  ...validated({ query: listMovementsQuerySchema }, inventoryController.listMovements),
);
inventoryRouter.post(
  '/movements',
  ...validated({ body: recordMovementSchema }, inventoryController.recordMovement),
);
inventoryRouter.post(
  '/transfers',
  ...validated({ body: transferStockSchema }, inventoryController.transfer),
);
