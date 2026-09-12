import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import { requireActor } from '../../core/security/actor.js';
import { resolvePeriod } from '../analytics/period.js';
import * as expenseService from './expense.service.js';
import type {
  createExpenseSchema,
  expenseIdParamSchema,
  expenseSummaryQuerySchema,
  listExpensesQuerySchema,
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

/**
 * The period is resolved from the actor's own clock, as the dashboard's is, so
 * "this month" here and "this month" there are the same days.
 */
export const summary: ValidatedHandler<{ query: typeof expenseSummaryQuerySchema }> = async (
  req,
  res,
) => {
  const actor = requireActor(req);
  const { period: key, from, to, branchId } = req.validated.query;
  const period = resolvePeriod({ key, timezone: actor.timezone, from, to });

  sendSuccess(req, res, await expenseService.summariseExpenses(actor, period, { branchId }));
};

export const detail: ValidatedHandler<{ params: typeof expenseIdParamSchema }> = async (
  req,
  res,
) => {
  sendSuccess(
    req,
    res,
    await expenseService.getExpense(requireActor(req), req.validated.params.id),
  );
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

export const remove: ValidatedHandler<{ params: typeof expenseIdParamSchema }> = async (
  req,
  res,
) => {
  sendSuccess(
    req,
    res,
    await expenseService.deleteExpense(requireActor(req), req.validated.params.id),
  );
};
