import type { ColumnMapping } from '@hadiya/shared';

/**
 * Lining a spreadsheet's columns up with Hadiya's own vocabulary.
 *
 * A business export calls revenue "Revenue", "Total", "Summa", "Tushum" or
 * "Sotuv summasi" depending on who made it, so a mapping is unavoidable. What
 * *is* avoidable is guessing: a file with both "Revenue" and "Net Revenue" has
 * two plausible answers, and picking one silently produces a confident comparison
 * that is wrong about money.
 *
 * So this scores candidates and, when the top two are close, reports the choice
 * as ambiguous and lets the assistant ask. Asking one question is cheaper than
 * being quietly wrong about a month's takings.
 */

/**
 * Known names per field, best first.
 *
 * Uzbek and Russian spellings sit alongside English because the exports this
 * will actually meet are written in all three, often in the same workbook.
 */
const FIELD_ALIASES: Record<string, readonly string[]> = {
  productName: [
    'product name',
    'product',
    'mahsulot',
    'mahsulot nomi',
    'tovar',
    'nomi',
    'name',
    'наименование',
    'товар',
    'item',
    'sku',
  ],
  revenue: [
    'revenue',
    'net revenue',
    'total',
    'net total',
    'amount',
    'summa',
    'tushum',
    'savdo',
    'sotuv summasi',
    'сумма',
    'выручка',
    'itogo',
    'jami',
  ],
  quantity: [
    'quantity',
    'qty',
    'soni',
    'miqdor',
    'miqdori',
    'dona',
    'количество',
    'кол-во',
    'units',
    'sold',
  ],
};

export const MAPPABLE_FIELDS = Object.keys(FIELD_ALIASES);

const normalise = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/**
 * How well one column name matches one field, 0–1.
 *
 * Exact alias beats containment, and an earlier alias beats a later one, so
 * "Revenue" outranks "Net Revenue Adjusted" for `revenue` rather than the two
 * tying on the strength of sharing a word.
 */
export const scoreColumn = (column: string, field: string): number => {
  const aliases = FIELD_ALIASES[field] ?? [];
  const name = normalise(column);

  if (name.length === 0) {
    return 0;
  }

  for (const [position, alias] of aliases.entries()) {
    const rank = 1 - position / (aliases.length * 2);

    if (name === alias) {
      return rank;
    }
  }

  for (const [position, alias] of aliases.entries()) {
    const rank = (1 - position / (aliases.length * 2)) * 0.6;

    // Word-boundary containment, so "quantity sold" matches `quantity` but
    // "unquantified" does not.
    if (name.split(' ').includes(alias) || name.includes(` ${alias} `)) {
      return rank;
    }

    if (name.startsWith(`${alias} `) || name.endsWith(` ${alias}`)) {
      return rank * 0.9;
    }
  }

  return 0;
};

/** Below this nothing is claimed; the field is reported as unmapped. */
const MIN_CONFIDENCE = 0.3;

/**
 * How close two candidates may be before the choice is called ambiguous.
 *
 * A narrow gap means the file genuinely has two columns that could be the one
 * meant, which is a question for the person rather than a coin toss.
 */
const AMBIGUITY_MARGIN = 0.12;

export const mapColumns = (columns: string[], fields = MAPPABLE_FIELDS): ColumnMapping[] =>
  fields.map((field) => {
    const ranked = columns
      .map((column) => ({ column, score: scoreColumn(column, field) }))
      .filter((entry) => entry.score >= MIN_CONFIDENCE)
      .sort((left, right) => right.score - left.score);

    const best = ranked[0];
    const runnerUp = ranked[1];

    if (!best) {
      return { field, column: null, confidence: 0, alternatives: [] };
    }

    const ambiguous = runnerUp !== undefined && best.score - runnerUp.score < AMBIGUITY_MARGIN;

    return {
      field,
      // Left unmapped when two columns are too close to separate. The caller
      // turns this into a question rather than into a silent choice.
      column: ambiguous ? null : best.column,
      confidence: Math.round(best.score * 100) / 100,
      alternatives: ambiguous
        ? ranked.slice(0, 3).map((entry) => entry.column)
        : ranked.slice(1, 3).map((entry) => entry.column),
    };
  });

/**
 * The question to ask when a mapping could not be settled, or `null`.
 *
 * Written as one sentence naming the real columns, because "I could not map the
 * revenue column" is not something a person can answer and "Which of Revenue or
 * Net Revenue should I use?" is.
 */
export const clarificationFor = (
  mappings: ColumnMapping[],
  required: readonly string[],
): string | null => {
  const unresolved = mappings.filter(
    (mapping) => required.includes(mapping.field) && mapping.column === null,
  );

  if (unresolved.length === 0) {
    return null;
  }

  const questions = unresolved.map((mapping) =>
    mapping.alternatives.length > 0
      ? `"${mapping.field}" uchun qaysi ustundan foydalanay: ${mapping.alternatives.join(', ')}?`
      : `"${mapping.field}" ustunini topa olmadim — qaysi ustun ekanini ayting.`,
  );

  return questions.join(' ');
};
