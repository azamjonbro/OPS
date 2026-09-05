import {
  DOCUMENT_KINDS,
  FILE_STATUSES,
  type DocumentChunk,
  type DocumentKind,
  type DocumentSummary,
  type FileStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';
import type { ExtractedTable } from './extractors/extractor.js';

/**
 * An uploaded document, and what was made of it.
 *
 * The extraction is stored alongside the metadata rather than recomputed on
 * every question: parsing a workbook is expensive and entirely deterministic,
 * so doing it once at upload and keeping the result is both faster and — more
 * usefully — means every answer about a file is drawn from the same reading of
 * it rather than from a fresh parse that might differ.
 *
 * `storageKey` lives here and never leaves the server. It is how the bytes are
 * found; a client that could see one could try to guess another.
 */
export interface FileDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  displayName: string;
  kind: DocumentKind;
  contentType: string;
  sizeBytes: number;
  status: FileStatus;
  storageKey: string | null;
  failureReason: string | null;
  summary: DocumentSummary | null;
  /** Plain text, bounded at extraction. Empty for a pure spreadsheet. */
  text: string;
  tables: ExtractedTable[];
  chunks: DocumentChunk[];
  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = createSchema<FileDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  displayName: { type: String, required: true, trim: true, maxlength: 200 },
  kind: { type: String, required: true, enum: DOCUMENT_KINDS },
  contentType: { type: String, required: true, maxlength: 120 },
  sizeBytes: { type: Number, required: true, min: 0 },
  status: { type: String, required: true, enum: FILE_STATUSES, default: 'processing' },
  storageKey: { type: String, default: null, maxlength: 200 },
  failureReason: { type: String, default: null, maxlength: 500 },
  summary: { type: Schema.Types.Mixed, default: null },
  // Not `required`: Mongoose treats an empty string as absent, and a document
  // with no extractable text — a scanned PDF, a workbook of pure numbers — is
  // an ordinary outcome rather than a validation failure.
  text: { type: String, default: '' },
  tables: { type: Schema.Types.Mixed, required: true, default: [] },
  chunks: { type: Schema.Types.Mixed, required: true, default: [] },
});

// The list a person sees: their own files, newest first.
fileSchema.index({ user: 1, createdAt: -1 });
// Retention sweeps.
fileSchema.index({ status: 1, updatedAt: 1 });

export const FileModel: Model<FileDocument> = model<FileDocument>('File', fileSchema);
