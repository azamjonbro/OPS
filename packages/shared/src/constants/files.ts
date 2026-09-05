/**
 * What Hadiya will accept as a document, and what it will do with it.
 *
 * The list is short on purpose. Every format here is one that a well-maintained
 * parser reads reliably; a format that cannot be read reliably is refused with
 * a sentence rather than accepted and half-understood, because a spreadsheet
 * that was parsed *almost* right is worse than one that was rejected — nobody
 * checks a number the assistant states confidently.
 */

export const DOCUMENT_KINDS = ['pdf', 'xlsx', 'csv', 'txt', 'md', 'docx'] as const;

export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/**
 * The content types a browser actually sends for each kind.
 *
 * Several per kind because browsers disagree: a CSV arrives as `text/csv` from
 * one and `application/vnd.ms-excel` from another, and a `.md` usually arrives
 * as `text/plain` or with no type at all. The declared type is a hint that is
 * cross-checked against the extension and the file's own first bytes; none of
 * the three is trusted alone.
 */
export const DOCUMENT_CONTENT_TYPES: Record<DocumentKind, readonly string[]> = {
  pdf: ['application/pdf'],
  xlsx: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
  csv: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  txt: ['text/plain'],
  md: ['text/markdown', 'text/x-markdown', 'text/plain'],
  docx: [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream',
  ],
};

/** The extension is what finally decides the kind, after the checks agree. */
export const DOCUMENT_EXTENSIONS: Record<DocumentKind, readonly string[]> = {
  pdf: ['pdf'],
  xlsx: ['xlsx'],
  csv: ['csv'],
  txt: ['txt'],
  md: ['md', 'markdown'],
  docx: ['docx'],
};

/** What each kind is stored and served as, chosen by the server, never echoed. */
export const DOCUMENT_STORAGE_CONTENT_TYPE: Record<DocumentKind, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * The first bytes each binary format must actually begin with.
 *
 * This is what stops extension spoofing. A `.exe` renamed to `.pdf` declares
 * `application/pdf`, matches the extension, and is caught here — the browser's
 * word and the filename are both things an attacker controls, and the bytes are
 * the only claim that is expensive to fake.
 *
 * The text kinds have no signature and are validated by decoding instead.
 */
export const DOCUMENT_MAGIC_BYTES: Partial<Record<DocumentKind, readonly number[]>> = {
  // "%PDF"
  pdf: [0x25, 0x50, 0x44, 0x46],
  // "PK\x03\x04" — both are ZIP containers of XML.
  xlsx: [0x50, 0x4b, 0x03, 0x04],
  docx: [0x50, 0x4b, 0x03, 0x04],
};

export const FILE_STATUSES = ['uploading', 'processing', 'ready', 'failed', 'deleted'] as const;

export type FileStatus = (typeof FILE_STATUSES)[number];

/**
 * Ceilings, all configurable through the environment.
 *
 * They exist to bound memory and cost rather than to be generous or mean. The
 * row and character limits in particular are what keep a 200 000-row export
 * from becoming either an out-of-memory crash or a prompt nobody can afford —
 * the answer to a large spreadsheet is to compute over it, not to read it aloud
 * to a model.
 */
export const FILE_LIMITS = {
  /** One upload. Comfortably above a real business export, far below trouble. */
  maxBytes: 20 * 1024 * 1024,
  /** Below this there is nothing to read. */
  minBytes: 8,
  /** Pages of a PDF that will be extracted. */
  maxPages: 300,
  /** Rows of a sheet or CSV held in memory and made queryable. */
  maxRows: 50_000,
  /** Characters of extracted text kept for search and summarising. */
  maxTextChars: 400_000,
  /** Columns per sheet; past this a file is a database export, not a report. */
  maxColumns: 200,
  /** Sheets read from one workbook. */
  maxSheets: 30,
  /** Files one account may upload per minute. */
  uploadsPerMinute: 20,
} as const;

/** The form field the file arrives on, named once so both sides agree. */
export const FILE_UPLOAD_FIELD = 'file';

/**
 * How long text is chunked into for search.
 *
 * Big enough that a paragraph survives intact, small enough that a hit returns
 * something a person can read rather than a page. Overlap keeps a sentence that
 * straddles a boundary findable from either side.
 */
export const DOCUMENT_CHUNK = {
  targetChars: 1_200,
  overlapChars: 150,
  /** Chunks returned to the model for one question. */
  maxResults: 6,
} as const;

/** Rows a table query will return; aggregates are computed over everything. */
export const TABLE_QUERY_MAX_ROWS = 50;

/**
 * How long an upload lives before it is swept.
 *
 * Files are the user's, so nothing is removed silently while it is in use;
 * this is the ceiling for material nobody has referred to since.
 */
export const FILE_RETENTION_DAYS = 90;

export const isDocumentKind = (value: string): value is DocumentKind =>
  (DOCUMENT_KINDS as readonly string[]).includes(value);

/** Every extension the upload dialog should offer, as `.pdf,.xlsx,…`. */
export const DOCUMENT_ACCEPT_ATTRIBUTE = DOCUMENT_KINDS.flatMap((kind) =>
  DOCUMENT_EXTENSIONS[kind].map((extension) => `.${extension}`),
).join(',');
