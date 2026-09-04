import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as expenseController from './expense.controller.js';
import {
  createExpenseSchema,
  expenseIdParamSchema,
  listExpensesQuerySchema,
  reviewExpenseSchema,
  updateExpenseSchema,
} from './expense.validators.js';

export const expenseRouter: Router = Router();

expenseRouter.post('/', ...validated({ body: createExpenseSchema }, expenseController.create));
expenseRouter.get('/', ...validated({ query: listExpensesQuerySchema }, expenseController.list));
expenseRouter.get('/:id', ...validated({ params: expenseIdParamSchema }, expenseController.detail));
expenseRouter.patch(
  '/:id',
  ...validated(
    { params: expenseIdParamSchema, body: updateExpenseSchema },
    expenseController.update,
  ),
);
/** Approve, reject or mark paid — a decision, not a field edit. */
expenseRouter.post(
  '/:id/review',
  ...validated(
    { params: expenseIdParamSchema, body: reviewExpenseSchema },
    expenseController.review,
  ),
);
expenseRouter.delete(
  '/:id',
  ...validated({ params: expenseIdParamSchema }, expenseController.remove),
);
