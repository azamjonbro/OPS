import type { DocumentKind, SheetSummary } from '@hadiya/shared';

/**
 * The seam between "some bytes" and "something the assistant can reason about".
 *
 * An extractor knows one format and nothing else: not storage, not the
 * database, not the agent, and above all not the AI provider. That keeps a
 * parser replaceable — the PDF reader can change without anything downstream
 * noticing — and it keeps parsing testable against a buffer rather than against
 * a running system.
 *
 * Every extractor is bounded and every one reports what it could not do.
 * Silence is the failure mode that matters here: a spreadsheet whose last forty
 * thousand rows were dropped without a word produces totals that are wrong and
 * look right.
 */

/** One table, as every tabular format is normalised into. */
export interface ExtractedTable {
  name: string;
  columns: string[];
  /** Cell values keyed by column name. `null` for an empty cell. */
  rows: Array<Record<string, string | number | null>>;
  /** Rows the source held, which may exceed the rows kept. */
  totalRows: number;
  truncated: boolean;
}

export interface ExtractionResult {
  kind: DocumentKind;
  /** Plain text for search and summarising. Empty for a pure spreadsheet. */
  text: string;
  /** 1-based page boundaries, where the format has them. */
  pages: Array<{ page: number; text: string }>;
  tables: ExtractedTable[];
  pageCount: number | null;
  /** Things the reader could not do, in words a person can act on. */
  warnings: string[];
  /** True when a limit stopped the read short of the whole document. */
  truncated: boolean;
}

export interface DocumentExtractor {
  readonly kind: DocumentKind;
  extract: (data: Buffer) => Promise<ExtractionResult>;
}

export const emptyResult = (kind: DocumentKind): ExtractionResult => ({
  kind,
  text: '',
  pages: [],
  tables: [],
  pageCount: null,
  warnings: [],
  truncated: false,
});

/**
 * A failure the caller should report rather than retry.
 *
 * Carries a sentence written for a shopkeeper. The parser's own error — which
 * names offsets, XML parts and sometimes a path — is logged and never travels
 * with this.
 */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/** Describes a table for the summary, without carrying its rows. */
export const summariseTable = (table: ExtractedTable): SheetSummary => ({
  name: table.name,
  rowCount: table.totalRows,
  columns: table.columns.map((column) => {
    const values = table.rows
      .map((row) => row[column])
      .filter(
        (value): value is string | number => value !== null && value !== undefined && value !== '',
      );

    const numeric = values.filter((value) => typeof value === 'number').length;
    // A spreadsheet has no schema, so the kind is inferred from what is
    // actually in the column — a column of numbers stored as text is the
    // normal case, not an anomaly.
    const looksNumeric = values.length > 0 && numeric / values.length >= 0.8;
    const looksDate =
      !looksNumeric &&
      values.length > 0 &&
      values.filter((value) => typeof value === 'string' && !Number.isNaN(Date.parse(value)))
        .length /
        values.length >=
        0.8;

    return {
      name: column,
      kind: values.length === 0 ? 'empty' : looksNumeric ? 'number' : looksDate ? 'date' : 'text',
      filled: values.length,
      samples: values.slice(0, 3).map((value) => String(value).slice(0, 60)),
    } as const;
  }),
});
