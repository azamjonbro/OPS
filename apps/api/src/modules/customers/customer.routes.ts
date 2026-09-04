import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as customerController from './customer.controller.js';
import {
  createCustomerSchema,
  customerIdParamSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './customer.validators.js';

export const customerRouter: Router = Router();

customerRouter.post('/', ...validated({ body: createCustomerSchema }, customerController.create));
customerRouter.get('/', ...validated({ query: listCustomersQuerySchema }, customerController.list));
customerRouter.get(
  '/:id',
  ...validated({ params: customerIdParamSchema }, customerController.detail),
);
customerRouter.patch(
  '/:id',
  ...validated(
    { params: customerIdParamSchema, body: updateCustomerSchema },
    customerController.update,
  ),
);
customerRouter.delete(
  '/:id',
  ...validated({ params: customerIdParamSchema }, customerController.block),
);
