import {
  TABLE_QUERY_MAX_ROWS,
  type TableAggregate,
  type TableFilter,
  type TableQueryResult,
} from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';
import type { ExtractedTable } from './extractors/extractor.js';

/**
 * Arithmetic over a spreadsheet, done in code.
 *
 * This exists so that a model is never handed forty thousand rows and asked
 * what they add up to. That approach is slow, expensive, and — the part that
 * matters — unreliable in a way nobody can see: a model that mis-totals a
 * column states the wrong figure with exactly the confidence it would state the
 * right one. Here the sum is a sum.
 *
 * Everything is pure and synchronous, so every operation below is testable
 * against a literal table with no file, no database and no network.
 */

/** Case- and space-insensitive, because a header is typed by a person. */
const findColumn = (table: ExtractedTable, name: string): string => {
  const wanted = name.trim().toLowerCase();
  const match = table.columns.find((column) => column.trim().toLowerCase() === wanted);

  if (match) {
    return match;
  }

  // Named rather than ignored: a query against a column that is not there is a
  // mistake worth surfacing, and the available columns are the useful reply.
  throw ApiError.badRequest(
    `"${name}" ustuni topilmadi. Mavjud ustunlar: ${table.columns.join(', ')}.`,
  );
};

/**
 * A cell as a number, or `null`.
 *
 * Deliberately narrow. A value that is already a number is one; a string that
 * is entirely a number is one. Anything else — "1 200", "$5", "n/a" — is not,
 * and is excluded from the aggregate rather than coerced to zero. Coercing to
 * zero is how a column with twenty unparseable cells reports an average that is
 * quietly too low.
 */
export const numericValue = (value: string | number | null | undefined): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const text = value.trim();

  if (text.length === 0 || !/^-?\d+(\.\d+)?$/.test(text)) {
    return null;
  }

  const parsed = Number(text);

  return Number.isFinite(parsed) ? parsed : null;
};

const matches = (
  row: Record<string, string | number | null>,
  filter: TableFilter,
  column: string,
): boolean => {
  const cell = row[column];

  if (filter.operator === 'equals') {
    return (
      String(cell ?? '')
        .trim()
        .toLowerCase() === filter.value.trim().toLowerCase()
    );
  }

  if (filter.operator === 'contains') {
    return String(cell ?? '')
      .toLowerCase()
      .includes(filter.value.trim().toLowerCase());
  }

  const left = numericValue(cell);
  const right = numericValue(filter.value);

  // A numeric comparison against something that is not a number excludes the
  // row rather than throwing: one bad cell should not fail the whole query.
  if (left === null || right === null) {
    return false;
  }

  switch (filter.operator) {
    case 'gt':
      return left > right;
    case 'gte':
      return left >= right;
    case 'lt':
      return left < right;
    case 'lte':
      return left <= right;
  }
};

export interface TableQuery {
  filters?: TableFilter[];
  aggregate?: { operation: TableAggregate; column: string };
  groupBy?: { column: string; valueColumn: string };
  sortBy?: { column: string; direction: 'asc' | 'desc' };
  limit?: number;
}

const aggregateOver = (values: number[], operation: TableAggregate): number | null => {
  if (operation === 'count') {
    return values.length;
  }

  if (values.length === 0) {
    // No usable numbers. `null`, never zero — "the column had nothing in it"
    // and "the column added up to nothing" are different answers.
    return null;
  }

  switch (operation) {
    case 'sum':
      return values.reduce((total, value) => total + value, 0);
    case 'average':
      return values.reduce((total, value) => total + value, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
  }
};

/**
 * Filters, aggregates, groups and sorts one table.
 *
 * Aggregates are computed over *every* matching row; only the rows handed back
 * are capped. That distinction is the whole point — the answer to "what is the
 * total?" must not depend on how many rows fit in a reply.
 */
export const queryTable = (table: ExtractedTable, query: TableQuery): TableQueryResult => {
  const filters = (query.filters ?? []).map((filter) => ({
    filter,
    column: findColumn(table, filter.column),
  }));

  const matched = table.rows.filter((row) =>
    filters.every(({ filter, column }) => matches(row, filter, column)),
  );

  const aggregate = query.aggregate
    ? (() => {
        const column = findColumn(table, query.aggregate.column);
        const values = matched
          .map((row) => numericValue(row[column]))
          .filter((value): value is number => value !== null);

        const value = aggregateOver(values, query.aggregate.operation);

        return {
          operation: query.aggregate.operation,
          column,
          // Rounded to two places: these are money and counts, and a float tail
          // of seventeen digits is noise in every answer it appears in.
          value: value === null ? null : Math.round(value * 100) / 100,
          counted: values.length,
        };
      })()
    : null;

  const groups = query.groupBy
    ? (() => {
        const keyColumn = findColumn(table, query.groupBy.column);
        const valueColumn = findColumn(table, query.groupBy.valueColumn);
        const totals = new Map<string, { value: number; rows: number }>();

        for (const row of matched) {
          const key = String(row[keyColumn] ?? '—').slice(0, 120);
          const entry = totals.get(key) ?? { value: 0, rows: 0 };

          entry.value += numericValue(row[valueColumn]) ?? 0;
          entry.rows += 1;
          totals.set(key, entry);
        }

        return [...totals.entries()]
          .map(([key, entry]) => ({
            key,
            value: Math.round(entry.value * 100) / 100,
            rows: entry.rows,
          }))
          .sort((left, right) => right.value - left.value)
          .slice(0, TABLE_QUERY_MAX_ROWS);
      })()
    : null;

  const sorted = query.sortBy
    ? (() => {
        const column = findColumn(table, query.sortBy.column);
        const direction = query.sortBy.direction === 'asc' ? 1 : -1;

        return [...matched].sort((left, right) => {
          const a = numericValue(left[column]);
          const b = numericValue(right[column]);

          if (a !== null && b !== null) {
            return (a - b) * direction;
          }

          return String(left[column] ?? '').localeCompare(String(right[column] ?? '')) * direction;
        });
      })()
    : matched;

  const limit = Math.min(query.limit ?? TABLE_QUERY_MAX_ROWS, TABLE_QUERY_MAX_ROWS);

  return {
    sheet: table.name,
    matchedRows: matched.length,
    rows: sorted.slice(0, limit),
    aggregate,
    groups,
    truncated: matched.length > limit,
  };
};
