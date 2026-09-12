/**
 * Expenses are the one ledger Hadiya keeps for itself.
 *
 * Billz holds the takings but not the costs: its expense ledger sits behind
 * `/v1/gl-transaction`, which refuses the API token with a 403. So a shop that
 * wants to know what it spent — and, from that, what it kept — records the
 * spending here. This vocabulary is shared because the browser draws a
 * category as a label and the assistant speaks it in a sentence, and both must
 * mean the same thing.
 */

/**
 * Where the money went.
 *
 * `goods` is first for a reason: for a retail shop the stock it buys to resell
 * is the largest cost by far, and the one the margin question turns on. The
 * rest are the ordinary running costs of a shop, and `other` catches what
 * nobody thought of without forcing a person to lie about a category.
 */
export const EXPENSE_CATEGORIES = [
  'goods',
  'rent',
  'salary',
  'utilities',
  'supplies',
  'transport',
  'marketing',
  'maintenance',
  'taxes',
  'bank_fees',
  'other',
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/** Plain-language names, for a card or a sentence. */
export const EXPENSE_CATEGORY_LABELS: Readonly<Record<ExpenseCategory, string>> = Object.freeze({
  goods: 'Tovar xaridi',
  rent: 'Ijara',
  salary: 'Oylik',
  utilities: 'Kommunal',
  supplies: 'Sarf materiallar',
  transport: 'Transport',
  marketing: 'Marketing',
  maintenance: "Ta'mirlash",
  taxes: 'Soliqlar',
  bank_fees: 'Bank xizmati',
  other: 'Boshqa',
});

/** How it was paid, which is what a cash count at the end of the day needs. */
export const EXPENSE_PAYMENT_METHODS = ['cash', 'card', 'transfer'] as const;

export type ExpensePaymentMethod = (typeof EXPENSE_PAYMENT_METHODS)[number];

export const EXPENSE_NOTE_MAX_LENGTH = 1_000;
export const EXPENSE_VENDOR_MAX_LENGTH = 160;

/**
 * The largest single expense accepted, in minor units: one billion so'm.
 *
 * A bound rather than a business rule. The amount can be typed by a person or
 * written by the model from a sentence, and a slipped zero on "12 000 000"
 * should be refused at the door rather than sit in a monthly total nobody
 * believes.
 */
export const EXPENSE_MAX_AMOUNT = 100_000_000_000;

/**
 * How far back an expense may be dated when it is recorded.
 *
 * Costs are often entered after the fact — the electricity bill arrives on the
 * fifth for the month before — so back-dating is allowed. Two years covers a
 * late tax bill; anything older is far more likely to be a mistyped year.
 */
export const EXPENSE_MAX_BACKDATE_DAYS = 731;

/** An expense may be dated a little ahead, for a bill known to fall due. */
export const EXPENSE_MAX_FUTURE_DAYS = 31;
