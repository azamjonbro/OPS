import {
  buildPaginationMeta,
  DEFAULT_CURRENCY,
  EXPENSE_CATEGORIES,
  EXPENSE_MAX_BACKDATE_DAYS,
  EXPENSE_MAX_FUTURE_DAYS,
  formatIsoDateInTimeZone,
  hasAtLeastRole,
  isObjectIdString,
  resolvePagination,
  searchRegexFilter,
  type AnalyticsPeriod,
  type AuthenticatedUser,
  type ExpenseCategory,
  type ExpenseCategoryTotal,
  type ExpenseDailyPoint,
  type ExpensePaymentMethod,
  type ExpenseSummary,
  type PaginatedResult,
  type UserRole,
} from '@hadiya/shared';

import { toObjectId, toObjectIdOrNull } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { canAccessAllBranches } from '../../core/security/actor.js';
import { ExpenseModel, type ExpenseDocument } from './expense.model.js';

const log = createLogger('expenses');

/**
 * The expense ledger.
 *
 * Anyone signed in may record a cost: the cashier who paid the water carrier
 * out of the till is the person who knows about it, and making them ask a
 * manager to write it down is how costs go unrecorded. Changing or removing a
 * row is narrower — the person who wrote it, or a manager — so one employee
 * cannot quietly edit another's entry.
 *
 * Reads are scoped by branch exactly as the rest of Hadiya scopes them: an
 * organisation-wide role sees everything (or the branch it asks for), and
 * branch-bound staff see their own branch and nothing else.
 *
 * Nothing here talks to Billz. Billz refuses to share its expense ledger with
 * an API token, which is the whole reason this module exists.
 */

/** From this role a person may change or remove anybody's entry. */
const REVIEW_ROLE: UserRole = 'manager';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** `YYYY-MM-DD` as a UTC midnight, so two days can be subtracted. */
const dayToMillis = (day: string): number => Date.parse(`${day}T00:00:00Z`);

/**
 * Refuses a day the calendar does not have, and one too far from today.
 *
 * The shape is checked by the validator; what is checked here is meaning. A
 * bill for last month is ordinary, and one a few weeks ahead is a bill known to
 * fall due. Two years back is a mistyped year, and so is next year.
 */
const assertReasonableDay = (day: string, today: string): void => {
  const millis = dayToMillis(day);

  if (Number.isNaN(millis) || formatIsoDateInTimeZone(new Date(millis), 'UTC') !== day) {
    throw ApiError.badRequest(`${day} is not a calendar day`);
  }

  const daysFromToday = Math.round((millis - dayToMillis(today)) / DAY_MS);

  if (daysFromToday < -EXPENSE_MAX_BACKDATE_DAYS) {
    throw ApiError.badRequest(
      `An expense cannot be dated more than ${EXPENSE_MAX_BACKDATE_DAYS} days ago`,
    );
  }

  if (daysFromToday > EXPENSE_MAX_FUTURE_DAYS) {
    throw ApiError.badRequest(
      `An expense cannot be dated more than ${EXPENSE_MAX_FUTURE_DAYS} days ahead`,
    );
  }
};

/**
 * Which branch a new expense belongs to.
 *
 * Differs from the platform's `resolveBranchForWrite` in one respect: an
 * account with no branch is not an error here, whatever its role. The owner
 * paying the business's rent is recording a cost of the business, not of a
 * branch, and `null` is the honest answer; and this deployment is one shop,
 * where a cashier without a branch is the ordinary case rather than a
 * misconfiguration. Naming *another* branch is still refused.
 */
const resolveBranchForWrite = (
  actor: AuthenticatedUser,
  requested: string | null | undefined,
): string | null => {
  if (canAccessAllBranches(actor)) {
    return requested ?? actor.branchId ?? null;
  }

  if (requested && requested !== actor.branchId) {
    throw ApiError.forbidden('You may only record expenses for your own branch');
  }

  return actor.branchId ?? null;
};

/**
 * The branch filter a read carries.
 *
 * Nothing for an organisation-wide read, and nothing for staff with no branch:
 * the sales figures beside these are scoped by the deployment's shop, not by
 * the reader's branch, and the dashboard would be lying if the takings were
 * the whole shop's and the costs were a branch's.
 */
const branchFilterForRead = (
  actor: AuthenticatedUser,
  requested: string | null | undefined,
): Record<string, unknown> => {
  if (canAccessAllBranches(actor)) {
    return requested ? { branch: toObjectId(requested) } : {};
  }

  if (requested && requested !== actor.branchId) {
    throw ApiError.forbidden('You may only read your own branch');
  }

  return actor.branchId ? { branch: toObjectId(actor.branchId) } : {};
};

/** Live rows only: what was removed never appears in a list or a total. */
const live = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  deletedAt: null,
  ...extra,
});

const canChange = (actor: AuthenticatedUser, expense: ExpenseDocument): boolean =>
  String(expense.createdBy) === actor.id || hasAtLeastRole(actor.role, REVIEW_ROLE);

export interface CreateExpenseInput {
  category: ExpenseCategory;
  amount: number;
  date?: string | undefined;
  paymentMethod?: ExpensePaymentMethod | undefined;
  vendor?: string | null | undefined;
  note?: string | null | undefined;
  branchId?: string | null | undefined;
  conversationId?: string | null | undefined;
}

export const createExpense = async (
  actor: AuthenticatedUser,
  input: CreateExpenseInput,
  now: Date = new Date(),
): Promise<ExpenseDocument> => {
  const today = formatIsoDateInTimeZone(now, actor.timezone);
  const date = input.date ?? today;

  assertReasonableDay(date, today);

  const branchId = resolveBranchForWrite(actor, input.branchId);

  const created = await ExpenseModel.create({
    branch: toObjectIdOrNull(branchId),
    category: input.category,
    amount: input.amount,
    currency: DEFAULT_CURRENCY,
    date,
    paymentMethod: input.paymentMethod ?? 'cash',
    vendor: input.vendor?.trim() || null,
    note: input.note?.trim() || null,
    createdBy: toObjectId(actor.id),
    // Provenance only, as with reminders: a bad id drops the link rather than
    // failing the save.
    conversation: isObjectIdString(input.conversationId)
      ? toObjectIdOrNull(input.conversationId)
      : null,
    deletedAt: null,
    deletedBy: null,
  });

  const expense = created.toObject<ExpenseDocument>();

  log.info(
    { expenseId: String(expense._id), category: expense.category, amount: expense.amount, date },
    'expense recorded',
  );

  return expense;
};

export interface ListExpensesQuery {
  page: number;
  pageSize: number;
  from?: string | undefined;
  to?: string | undefined;
  category?: ExpenseCategory | undefined;
  paymentMethod?: ExpensePaymentMethod | undefined;
  branchId?: string | undefined;
  search?: string | undefined;
}

export const listExpenses = async (
  actor: AuthenticatedUser,
  query: ListExpensesQuery,
): Promise<PaginatedResult<ExpenseDocument>> => {
  const filter = live(branchFilterForRead(actor, query.branchId));

  if (query.from || query.to) {
    filter.date = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  if (query.category) {
    filter.category = query.category;
  }

  if (query.paymentMethod) {
    filter.paymentMethod = query.paymentMethod;
  }

  const search = searchRegexFilter(query.search);

  if (search) {
    filter.$or = [{ vendor: search }, { note: search }];
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    ExpenseModel.find(filter)
      // Newest day first, and within a day the most recently written.
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ExpenseDocument[]>()
      .exec(),
    ExpenseModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const getExpense = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<ExpenseDocument> => {
  const expense = await ExpenseModel.findOne(live({ _id: id, ...branchFilterForRead(actor, null) }))
    .lean<ExpenseDocument | null>()
    .exec();

  if (!expense) {
    // Another branch's row is reported as missing rather than forbidden: a 403
    // would confirm that the id exists.
    throw ApiError.notFound('Expense not found');
  }

  return expense;
};

export interface UpdateExpenseInput {
  category?: ExpenseCategory | undefined;
  amount?: number | undefined;
  date?: string | undefined;
  paymentMethod?: ExpensePaymentMethod | undefined;
  vendor?: string | null | undefined;
  note?: string | null | undefined;
}

export const updateExpense = async (
  actor: AuthenticatedUser,
  id: string,
  input: UpdateExpenseInput,
  now: Date = new Date(),
): Promise<ExpenseDocument> => {
  const existing = await getExpense(actor, id);

  if (!canChange(actor, existing)) {
    throw ApiError.forbidden(
      'Only the person who recorded this expense, or a manager, may change it',
    );
  }

  const update: Record<string, unknown> = {};

  if (input.date !== undefined) {
    assertReasonableDay(input.date, formatIsoDateInTimeZone(now, actor.timezone));
    update.date = input.date;
  }

  if (input.category !== undefined) {
    update.category = input.category;
  }

  if (input.amount !== undefined) {
    update.amount = input.amount;
  }

  if (input.paymentMethod !== undefined) {
    update.paymentMethod = input.paymentMethod;
  }

  if (input.vendor !== undefined) {
    update.vendor = input.vendor?.trim() || null;
  }

  if (input.note !== undefined) {
    update.note = input.note?.trim() || null;
  }

  const updated = await ExpenseModel.findOneAndUpdate(live({ _id: existing._id }), update, {
    new: true,
  })
    .lean<ExpenseDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Expense not found');
  }

  return updated;
};

/**
 * Removes an expense from every list and total, keeping the row.
 *
 * Soft on purpose: a cost that was written down and taken back is a fact worth
 * being able to see, and a month's total that once included it should still be
 * explicable. The response is the row as it now stands, `deletedAt` set.
 */
export const deleteExpense = async (
  actor: AuthenticatedUser,
  id: string,
  now: Date = new Date(),
): Promise<ExpenseDocument> => {
  const existing = await getExpense(actor, id);

  if (!canChange(actor, existing)) {
    throw ApiError.forbidden(
      'Only the person who recorded this expense, or a manager, may remove it',
    );
  }

  const deleted = await ExpenseModel.findOneAndUpdate(
    live({ _id: existing._id }),
    { deletedAt: now, deletedBy: toObjectId(actor.id) },
    { new: true },
  )
    .lean<ExpenseDocument | null>()
    .exec();

  if (!deleted) {
    throw ApiError.notFound('Expense not found');
  }

  log.info({ expenseId: id, by: actor.id }, 'expense removed');

  return deleted;
};

interface GroupedRow {
  _id: { category: ExpenseCategory; date: string };
  total: number;
  count: number;
}

/**
 * What a window cost, by category and by day.
 *
 * Grouped once in the database by (category, day) and folded twice here, which
 * is one query rather than two and keeps the arithmetic where a test can read
 * it. The window is an analytics period so the days match the sales figures
 * for the same request exactly.
 *
 * Every category is present in the answer, including the ones with nothing in
 * them: a card that lists "Ijara: 0" is telling the person that rent has not
 * been recorded this month, which is a more useful thing to know than that
 * the category exists.
 */
export const summariseExpenses = async (
  actor: AuthenticatedUser,
  period: Pick<AnalyticsPeriod, 'from' | 'to' | 'label'>,
  options: { branchId?: string | undefined } = {},
): Promise<ExpenseSummary> => {
  const filter = live({
    ...branchFilterForRead(actor, options.branchId),
    date: { $gte: period.from, $lte: period.to },
  });

  const rows = await ExpenseModel.aggregate<GroupedRow>([
    { $match: filter },
    {
      $group: {
        _id: { category: '$category', date: '$date' },
        total: { $sum: '$amount' },
        count: { $sum: 1 },
      },
    },
  ]).exec();

  const byCategoryMap = new Map<ExpenseCategory, { total: number; count: number }>(
    EXPENSE_CATEGORIES.map((category) => [category, { total: 0, count: 0 }]),
  );
  const byDayMap = new Map<string, { total: number; count: number }>();
  let total = 0;
  let count = 0;

  for (const row of rows) {
    total += row.total;
    count += row.count;

    const category = byCategoryMap.get(row._id.category) ?? { total: 0, count: 0 };
    byCategoryMap.set(row._id.category, {
      total: category.total + row.total,
      count: category.count + row.count,
    });

    const day = byDayMap.get(row._id.date) ?? { total: 0, count: 0 };
    byDayMap.set(row._id.date, { total: day.total + row.total, count: day.count + row.count });
  }

  const byCategory: ExpenseCategoryTotal[] = [...byCategoryMap.entries()]
    .map(([category, sums]) => ({
      category,
      total: sums.total,
      count: sums.count,
      share: total === 0 ? null : Math.round((sums.total / total) * 1_000) / 10,
    }))
    // Largest first, so the first line of the card is where the money went.
    .sort((left, right) => right.total - left.total);

  const daily: ExpenseDailyPoint[] = [...byDayMap.entries()]
    .map(([date, sums]) => ({ date, ...sums }))
    .sort((left, right) => left.date.localeCompare(right.date));

  return {
    period: { from: period.from, to: period.to, label: period.label },
    currency: DEFAULT_CURRENCY,
    total,
    count,
    byCategory,
    daily,
  };
};
