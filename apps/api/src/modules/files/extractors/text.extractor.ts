import { FILE_LIMITS, type DocumentKind } from '@hadiya/shared';
import Papa from 'papaparse';

import {
  emptyResult,
  type DocumentExtractor,
  type ExtractedTable,
  type ExtractionResult,
} from './extractor.js';

/**
 * The formats that are already text.
 *
 * Nothing here needs a parser for the *container* — the bytes are the content —
 * so the work is decoding safely and refusing to hold more than was agreed.
 */

/**
 * Decodes as UTF-8, dropping a byte-order mark.
 *
 * A BOM at the head of a CSV becomes part of the first column's name if it is
 * left in place, which quietly breaks every lookup of that column — a real and
 * very common failure with spreadsheets exported from Excel.
 */
export const decodeText = (data: Buffer): string => {
  const text = data.toString('utf8');

  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
};

const bounded = (text: string): { text: string; truncated: boolean } =>
  text.length > FILE_LIMITS.maxTextChars
    ? { text: text.slice(0, FILE_LIMITS.maxTextChars), truncated: true }
    : { text, truncated: false };

const plainTextExtractor = (kind: DocumentKind): DocumentExtractor => ({
  kind,
  extract: async (data: Buffer): Promise<ExtractionResult> => {
    const { text, truncated } = bounded(decodeText(data));

    return {
      ...emptyResult(kind),
      text,
      truncated,
      warnings: truncated
        ? [`Only the first ${FILE_LIMITS.maxTextChars} characters were read.`]
        : [],
    };
  },
});

export const txtExtractor = plainTextExtractor('txt');
export const mdExtractor = plainTextExtractor('md');

/** Blank, or a header a spreadsheet left behind — never a usable column name. */
const isUsableHeader = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

/**
 * Turns the header row into unique, trimmed column names.
 *
 * Duplicates are suffixed rather than collapsed: a real export often has two
 * columns called "Total", and silently dropping one loses data that the person
 * can see in their own file.
 */
export const normaliseColumns = (raw: unknown[]): string[] => {
  const seen = new Map<string, number>();

  return raw.map((value, index) => {
    const base = isUsableHeader(value) ? value.trim().slice(0, 80) : `column_${index + 1}`;
    const count = seen.get(base) ?? 0;

    seen.set(base, count + 1);

    return count === 0 ? base : `${base}_${count + 1}`;
  });
};

/** Numbers arrive as text; a value that is entirely a number becomes one. */
export const coerceCell = (value: unknown): string | number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();

  if (text.length === 0) {
    return null;
  }

  // Deliberately strict: only a bare number becomes a number. "1 200" and
  // "$1,200" stay text, because guessing a thousands separator is how a
  // European decimal comma turns 1,5 into fifteen.
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    const parsed = Number(text);

    return Number.isFinite(parsed) ? parsed : text;
  }

  return text.slice(0, 500);
};

/**
 * CSV, with the delimiter detected rather than assumed.
 *
 * Papa Parse sniffs the separator, which matters because a great many exports
 * in this region are semicolon-separated — a comma-only reader turns such a
 * file into one enormous column and reports no error at all.
 *
 * Rows are bounded and the original count is kept, so a truncated read is
 * visible as a truncated read rather than as a smaller business.
 */
export const csvExtractor: DocumentExtractor = {
  kind: 'csv',
  extract: async (data: Buffer): Promise<ExtractionResult> => {
    const parsed = Papa.parse<unknown[]>(decodeText(data), {
      skipEmptyLines: 'greedy',
      // Header handling is done below rather than by Papa, so a file whose
      // first row is not a header can still be read as data.
      header: false,
    });

    const rowsRaw = parsed.data.filter((row): row is unknown[] => Array.isArray(row));
    const warnings: string[] = [];

    if (rowsRaw.length === 0) {
      return { ...emptyResult('csv'), warnings: ['Bu faylda hech qanday satr topilmadi.'] };
    }

    const columns = normaliseColumns((rowsRaw[0] ?? []).slice(0, FILE_LIMITS.maxColumns));
    const body = rowsRaw.slice(1);
    const truncated = body.length > FILE_LIMITS.maxRows;
    const kept = truncated ? body.slice(0, FILE_LIMITS.maxRows) : body;

    if (truncated) {
      warnings.push(
        `Faylda ${body.length} satr bor; birinchi ${FILE_LIMITS.maxRows} tasi tahlil qilindi.`,
      );
    }

    if (parsed.errors.length > 0) {
      // The parser's own messages name row and column offsets, which is useful
      // in a log and meaningless on a screen.
      warnings.push('Ba’zi satrlarni o‘qishda muammo bo‘ldi.');
    }

    const table: ExtractedTable = {
      name: 'CSV',
      columns,
      rows: kept.map((row) =>
        Object.fromEntries(columns.map((column, index) => [column, coerceCell(row[index])])),
      ),
      totalRows: body.length,
      truncated,
    };

    return {
      ...emptyResult('csv'),
      tables: [table],
      warnings,
      truncated,
    };
  },
};
