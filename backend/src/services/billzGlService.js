const billzAdminSessionService = require('./billzAdminSessionService');

const ADMIN_API = 'https://api-admin.billz.ai';

// Billz's own gl-transaction `operation_type_name` vocabulary, as observed on real records
// this session (e.g. "Expense" on salary/rent-style payments). Sales themselves also show
// up in this ledger under other operation types — excluded here since sales are already
// covered by billzClientService.getSales()/order-search, and double-counting them as
// "expenses" would be wrong. This list may need widening once more real categories are
// seen in production (e.g. a distinct "Purchase"/"Supply" type for inventory investment —
// see getInvestmentForPeriod below, which is a best-effort filter pending confirmation).
const EXPENSE_OPERATION_TYPES = ['Expense', 'Расход'];

// Category text patterns that indicate money going INTO inventory/goods rather than an
// operating expense (rent, salary, utilities, etc). Billz doesn't expose a clean dedicated
// operation_type for this on every account, so this matches the Uzbek/Russian words shop
// owners actually type into the category field for restock/purchase entries. Intentionally
// conservative (real substrings observed in this account's own ledger during investigation:
// "tovarga" = "for goods") — widen only after checking real data, never guess broadly
// enough to misclassify a real operating expense as inventory investment.
const INVENTORY_CATEGORY_PATTERNS = [/tovarga/i, /tovar\s*uchun/i, /закуп/i, /постав/i];

function isInventoryCategory(category) {
  const c = String(category || '');
  return INVENTORY_CATEGORY_PATTERNS.some((re) => re.test(c));
}

/** One authenticated GET against the admin-session-gated ledger API. */
async function _glFetch(path) {
  const token = await billzAdminSessionService.getAdminToken();
  if (!token) return { ok: false, error: "Billz admin sessiyasi ulanmagan (Sozlamalar -> Billz Admin Session)" };

  try {
    const res = await fetch(`${ADMIN_API}${path}`, {
      headers: { accept: 'application/json', Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, error: `Billz gl-transaction xatosi (${res.status}): ${body.slice(0, 200)}` };
    }
    return { ok: true, data: await res.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Walks the full gl-transaction ledger (paginated, 100/page) and filters to `date_at`
 * within [startDate, endDate] client-side — the endpoint's own date-range query params
 * (if any) aren't confirmed yet, so this is the safe default. Confirmed field names from a
 * real record: id, external_id, category, amount, date_at, created_at, user_name,
 * created_by_user_name, cashbox_name, operation_type_name, payment_method_name, status,
 * child_id:{String,Valid}.
 */
async function _fetchAllGlTransactions(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  let all = [];
  let page = 1;
  const limit = 100;

  while (page <= 50) {
    const result = await _glFetch(`/v1/gl-transaction?limit=${limit}&page=${page}`);
    if (!result.ok) return { error: result.error };

    const txs = result.data.gl_transactions || [];
    all.push(...txs);
    if (txs.length < limit) break;
    page++;
  }

  const inRange = all.filter((t) => {
    const d = new Date((t.date_at || t.created_at || '').replace(' ', 'T'));
    return d >= start && d <= end;
  });

  return { transactions: inRange };
}

function moneyFields(t) {
  return {
    id: t.id,
    externalId: t.external_id,
    category: (t.category || '').trim() || (t.account_name || '').trim() || "Sabab ko'rsatilmagan",
    amount: Math.abs(t.amount || 0),
    dateAt: t.date_at,
    cashboxName: (t.cashbox_name && t.cashbox_name.String) || t.cashbox_name || '',
    operationTypeName: (t.operation_type_name && t.operation_type_name.String) || t.operation_type_name || '',
    createdByUserName: t.created_by_user_name || t.user_name || '',
    paymentMethodName: t.payment_method_name || ''
  };
}

/** Expense entries + by-category subtotal, for the period. Returns isRealData:false (never a fabricated 0) if the admin session isn't connected or the fetch fails. */
async function getExpensesForPeriod(startDate, endDate) {
  const { transactions, error } = await _fetchAllGlTransactions(startDate, endDate);
  if (error) return { success: false, isRealData: false, error };

  const expenseTx = transactions.filter((t) => {
    const opType = (t.operation_type_name && t.operation_type_name.String) || t.operation_type_name || '';
    return EXPENSE_OPERATION_TYPES.includes(opType) && !isInventoryCategory(t.category);
  });

  const expenses = expenseTx.map(moneyFields).sort((a, b) => String(a.dateAt).localeCompare(String(b.dateAt)));
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byCategoryMap = new Map();
  for (const e of expenses) {
    const agg = byCategoryMap.get(e.category) || { category: e.category, total: 0, count: 0 };
    agg.total += e.amount;
    agg.count += 1;
    byCategoryMap.set(e.category, agg);
  }
  const byCategory = [...byCategoryMap.values()].sort((a, b) => b.total - a.total);

  // Per-day totals, mirroring billzClientService's dailyBreakdown shape, so the formatter
  // can apply the same "single day -> one total, range -> daily totals + grand total" rule.
  const byDayMap = new Map();
  for (const e of expenses) {
    const day = String(e.dateAt || '').slice(0, 10);
    byDayMap.set(day, (byDayMap.get(day) || 0) + e.amount);
  }
  const dailyExpenseBreakdown = [...byDayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, total]) => ({ date, total }));

  return { success: true, isRealData: true, expenses, totalExpenses, byCategory, dailyExpenseBreakdown };
}

/** Inventory/goods-purchase entries for the period — see INVENTORY_CATEGORY_PATTERNS doc comment above for the confidence caveat. */
async function getInvestmentForPeriod(startDate, endDate) {
  const { transactions, error } = await _fetchAllGlTransactions(startDate, endDate);
  if (error) return { success: false, isRealData: false, error };

  const investmentTx = transactions.filter((t) => isInventoryCategory(t.category));
  const items = investmentTx.map(moneyFields);
  const totalInvestment = items.reduce((sum, e) => sum + e.amount, 0);

  return { success: true, isRealData: true, items, totalInvestment };
}

/** Sales revenue minus operating expenses (inventory investment reported separately, not double-subtracted). */
function computeNetProfit(totalSalesRevenue, totalExpenses) {
  if (totalSalesRevenue === null || totalSalesRevenue === undefined) return null;
  if (totalExpenses === null || totalExpenses === undefined) return null;
  return totalSalesRevenue - totalExpenses;
}

module.exports = { getExpensesForPeriod, getInvestmentForPeriod, computeNetProfit };
