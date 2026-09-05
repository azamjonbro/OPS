import type { DocumentKind, FileStatus } from '../constants/files.js';
import type { Entity } from './entity.js';

/**
 * A document somebody uploaded, as the rest of the system sees it.
 *
 * The storage key never appears here. It is the server's own identifier for
 * some bytes, and a client that could see one could try to ask for another —
 * downloads go through an authenticated endpoint that resolves ownership,
 * never through a path the browser was handed.
 */
export interface BusinessFile extends Entity {
  user: string;
  /** What the person called it, sanitised for display only. */
  displayName: string;
  kind: DocumentKind;
  contentType: string;
  sizeBytes: number;
  status: FileStatus;
  /** Set when extraction failed, in words a person can act on. */
  failureReason: string | null;
  summary: DocumentSummary | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * What was found in a document, without the document itself.
 *
 * Enough for a card, a tool description and a decision about what to read next
 * — deliberately not enough to answer a question from, so nothing is tempted to
 * treat this as the content.
 */
export interface DocumentSummary {
  kind: DocumentKind;
  /** PDFs and DOCX. `null` where the format has no pages. */
  pageCount: number | null;
  /** Characters of text extracted, after limits were applied. */
  textChars: number;
  /** Spreadsheets and CSV. */
  sheets: SheetSummary[];
  /** Things the reader could not do, said plainly rather than omitted. */
  warnings: string[];
  /** True when a limit stopped extraction short of the whole document. */
  truncated: boolean;
}

export interface SheetSummary {
  name: string;
  rowCount: number;
  columns: ColumnSummary[];
}

/**
 * One column, described well enough to query without reading the rows.
 *
 * `kind` is inferred from the values rather than declared by the file, because
 * a spreadsheet has no schema — a column of numbers stored as text is the
 * normal case, not the exception.
 */
export interface ColumnSummary {
  name: string;
  kind: 'number' | 'text' | 'date' | 'empty';
  /** How many rows carry a usable value, so emptiness is visible. */
  filled: number;
  /** A few real values, for recognising what the column actually holds. */
  samples: string[];
}

/** A slice of text, kept addressable so an answer can say where it came from. */
export interface DocumentChunk {
  index: number;
  text: string;
  /** 1-based, where the format has pages. */
  page: number | null;
  /** Sheet name, where the chunk came from a table. */
  sheet: string | null;
}

/** One search hit, with enough context to cite it. */
export interface DocumentSearchHit {
  chunk: DocumentChunk;
  /** Higher is more relevant. Deterministic keyword overlap, not a model. */
  score: number;
}

export type TableAggregate = 'sum' | 'average' | 'min' | 'max' | 'count';

/** A filter a tool may apply to a sheet before aggregating it. */
export interface TableFilter {
  column: string;
  operator: 'equals' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  value: string;
}

export interface TableQueryResult {
  sheet: string;
  /** Rows the filter matched, before any row limit was applied. */
  matchedRows: number;
  /** The rows actually returned, bounded. */
  rows: Array<Record<string, string | number | null>>;
  /** Present when an aggregate was asked for. */
  aggregate: {
    operation: TableAggregate;
    column: string;
    value: number | null;
    /** Rows that carried a usable number, so a gappy column is visible. */
    counted: number;
  } | null;
  /** Present when a grouping was asked for, largest first. */
  groups: Array<{ key: string; value: number; rows: number }> | null;
  truncated: boolean;
}

/**
 * A column of a document lined up against a Hadiya metric.
 *
 * Mapping is never guessed silently: a column that could be two things is
 * reported as ambiguous so the assistant can ask, because quietly picking the
 * wrong revenue column produces a confident answer that is wrong about money.
 */
export interface ColumnMapping {
  /** The canonical field, e.g. `productName`, `revenue`, `quantity`. */
  field: string;
  /** The column chosen, or `null` when nothing matched well enough. */
  column: string | null;
  confidence: number;
  /** Other columns that matched, when the choice was not clear-cut. */
  alternatives: string[];
}

export interface DocumentComparisonRow {
  name: string;
  documentValue: number;
  billzValue: number;
  difference: number;
  /** `null` rather than `Infinity` when there is no base to compare against. */
  percentDifference: number | null;
}

export interface DocumentComparison {
  sheet: string;
  mapping: ColumnMapping[];
  /** Set when a mapping was too uncertain to use; the caller must ask. */
  needsClarification: string | null;
  rows: DocumentComparisonRow[];
  documentTotal: number;
  billzTotal: number;
  difference: number;
  percentDifference: number | null;
  /** Names present in one source and not the other, which is usually the story. */
  onlyInDocument: string[];
  onlyInBillz: string[];
}
