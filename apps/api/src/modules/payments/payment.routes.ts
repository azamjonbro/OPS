import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as paymentController from './payment.controller.js';
import {
  listPaymentsQuerySchema,
  paymentIdParamSchema,
  recordPaymentSchema,
} from './payment.validators.js';

export const paymentRouter: Router = Router();

paymentRouter.post('/', ...validated({ body: recordPaymentSchema }, paymentController.create));
paymentRouter.get('/', ...validated({ query: listPaymentsQuerySchema }, paymentController.list));
paymentRouter.get('/:id', ...validated({ params: paymentIdParamSchema }, paymentController.detail));
/** Voiding keeps the record and marks it reversed, so it is not a DELETE. */
paymentRouter.post(
  '/:id/void',
  ...validated({ params: paymentIdParamSchema }, paymentController.voidPayment),
);
