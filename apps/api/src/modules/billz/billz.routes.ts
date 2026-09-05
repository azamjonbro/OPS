import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { validated } from '../../core/middleware/validate.js';
import * as billzController from './billz.controller.js';
import {
  billzCustomerQuerySchema,
  billzExternalIdParamSchema,
  billzInventoryQuerySchema,
  billzPeriodQuerySchema,
  billzProductQuerySchema,
  billzSalesQuerySchema,
} from './billz.validators.js';

/**
 * Hadiya's own view of Billz, mounted at `/api/v1/integrations/billz`.
 *
 * Every response here is normalised: a client of this API never sees a Billz
 * field name, its snake_case payloads or its pagination envelope, so the
 * integration can be re-shaped without touching anything downstream.
 */
export const billzRouter: Router = Router();

billzRouter.get('/status', asyncHandler(billzController.status));
billzRouter.get('/capabilities', billzController.capabilities);

billzRouter.get(
  '/products',
  ...validated({ query: billzProductQuerySchema }, billzController.listProducts),
);
billzRouter.get(
  '/products/:externalId',
  ...validated({ params: billzExternalIdParamSchema }, billzController.getProduct),
);
billzRouter.get('/categories', asyncHandler(billzController.listCategories));
billzRouter.get('/shops', asyncHandler(billzController.listShops));
billzRouter.get('/payment-types', asyncHandler(billzController.listPaymentTypes));

billzRouter.get(
  '/customers',
  ...validated({ query: billzCustomerQuerySchema }, billzController.listCustomers),
);

billzRouter.get(
  '/sales',
  ...validated({ query: billzSalesQuerySchema }, billzController.listSales),
);
billzRouter.get(
  '/sales/summary',
  ...validated({ query: billzPeriodQuerySchema }, billzController.salesSummary),
);
billzRouter.get(
  '/sales/payment-breakdown',
  ...validated({ query: billzPeriodQuerySchema }, billzController.paymentBreakdown),
);
billzRouter.get(
  '/sales/:externalId',
  ...validated({ params: billzExternalIdParamSchema }, billzController.getSale),
);

billzRouter.get(
  '/debts',
  ...validated({ query: billzPeriodQuerySchema }, billzController.listDebts),
);
billzRouter.get(
  '/inventory',
  ...validated({ query: billzInventoryQuerySchema }, billzController.listInventory),
);
