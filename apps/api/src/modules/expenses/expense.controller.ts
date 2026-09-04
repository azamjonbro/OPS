import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as expenseService from './expense.service.js';
import type {
  createExpenseSchema,
  expenseIdParamSchema,
  listExpensesQuerySchema,
  reviewExpenseSchema,
  updateExpenseSchema,
} from './expense.validators.js';

export const create: ValidatedHandler<{ body: typeof createExpenseSchema }> = async (req, res) => {
  const expense = await expenseService.createExpense(requireActor(req), req.validated.body);

  sendCreated(req, res, expense);
};

export const list: ValidatedHandler<{ query: typeof listExpensesQuerySchema }> = async (
  req,
  res,
) => {
  const result = await expenseService.listExpenses(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof expenseIdParamSchema }> = async (
  req,
  res,
) => {
  const expense = await expenseService.getExpense(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, expense);
};

export const update: ValidatedHandler<{
  params: typeof expenseIdParamSchema;
  body: typeof updateExpenseSchema;
}> = async (req, res) => {
  const expense = await expenseService.updateExpense(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, expense);
};

export const review: ValidatedHandler<{
  params: typeof expenseIdParamSchema;
  body: typeof reviewExpenseSchema;
}> = async (req, res) => {
  const expense = await expenseService.reviewExpense(
    requireActor(req),
    req.validated.params.id,
    req.validated.body.status,
  );

  sendSuccess(req, res, expense);
};

export const remove: ValidatedHandler<{ params: typeof expenseIdParamSchema }> = async (
  req,
  res,
) => {
  await expenseService.deleteExpense(requireActor(req), req.validated.params.id);

  sendNoContent(res);
};
