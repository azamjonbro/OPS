import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as expenseController from './expense.controller.js';
import {
  createExpenseSchema,
  expenseIdParamSchema,
  expenseSummaryQuerySchema,
  listExpensesQuerySchema,
  updateExpenseSchema,
} from './expense.validators.js';

/**
 * The expense ledger.
 *
 * No role check at the router: anyone signed in may record a cost and read
 * their branch's, and the narrower rules — who may change a row, which branch
 * a read covers — live in the service next to the queries they protect.
 */
export const expenseRouter: Router = Router();

expenseRouter.post('/', ...validated({ body: createExpenseSchema }, expenseController.create));
expenseRouter.get('/', ...validated({ query: listExpensesQuerySchema }, expenseController.list));
// Before `/:id`, so the word is not read as an id.
expenseRouter.get(
  '/summary',
  ...validated({ query: expenseSummaryQuerySchema }, expenseController.summary),
);
expenseRouter.get('/:id', ...validated({ params: expenseIdParamSchema }, expenseController.detail));
expenseRouter.patch(
  '/:id',
  ...validated(
    { params: expenseIdParamSchema, body: updateExpenseSchema },
    expenseController.update,
  ),
);
expenseRouter.delete(
  '/:id',
  ...validated({ params: expenseIdParamSchema }, expenseController.remove),
);
