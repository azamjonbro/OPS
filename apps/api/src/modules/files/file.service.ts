import {
  DOCUMENT_STORAGE_CONTENT_TYPE,
  buildPaginationMeta,
  resolvePagination,
  type AuthenticatedUser,
  type DocumentKind,
  type DocumentSearchHit,
  type DocumentSummary,
  type PaginatedResult,
} from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import { buildChunks, searchChunks } from './document-search.js';
import { docxExtractor, pdfExtractor, xlsxExtractor } from './extractors/office.extractor.js';
import { csvExtractor, mdExtractor, txtExtractor } from './extractors/text.extractor.js';
import {
  ExtractionError,
  summariseTable,
  type DocumentExtractor,
  type ExtractedTable,
  type ExtractionResult,
} from './extractors/extractor.js';
import { getFileStorage } from './file-storage.js';
import { FileModel, type FileDocument } from './file.model.js';
import { storageKeyFor, validateUpload } from './file-validation.js';

const log = createLogger('files');

/**
 * A person's documents, and the one way anything becomes one.
 *
 * Every read and write filters on the actor's id. That filter *is* the
 * authorisation: a query that cannot match another account's row cannot leak
 * it, which is a stronger guarantee than reading a document and then deciding
 * whether the caller should have seen it.
 *
 * Extraction happens once, at upload, and the result is stored. A question
 * about a file therefore never re-parses it — every answer is drawn from the
 * same reading, and a workbook is not parsed forty times in a conversation.
 */
const ownedBy = (actor: AuthenticatedUser, extra: Record<string, unknown> = {}) => ({
  user: toObjectId(actor.id),
  ...extra,
});

const EXTRACTORS: Record<DocumentKind, DocumentExtractor> = {
  pdf: pdfExtractor,
  xlsx: xlsxExtractor,
  csv: csvExtractor,
  txt: txtExtractor,
  md: mdExtractor,
  docx: docxExtractor,
};

const summarise = (kind: DocumentKind, extraction: ExtractionResult): DocumentSummary => ({
  kind,
  pageCount: extraction.pageCount,
  textChars: extraction.text.length,
  sheets: extraction.tables.map(summariseTable),
  warnings: extraction.warnings,
  truncated: extraction.truncated,
});

export interface UploadInput {
  filename: string;
  contentType: string;
  data: Buffer;
}

/**
 * Takes an upload from bytes to a readable document.
 *
 * The order matters and is deliberate. Validation runs *before* anything is
 * written, so a rejected file never reaches storage. The row is created before
 * the bytes are stored, so the storage key can be derived from an id the
 * database generated rather than from anything the caller sent. And if
 * extraction fails, the file is marked failed with a sentence rather than left
 * in `processing` for ever — a stuck spinner is indistinguishable from a lost
 * file to the person waiting on it.
 *
 * Cleanup is in `finally` on the failure path: a document whose extraction
 * threw has no reason to keep its bytes, and an orphaned object in storage is
 * a cost nobody is tracking.
 */
export const uploadFile = async (
  actor: AuthenticatedUser,
  input: UploadInput,
): Promise<FileDocument> => {
  const validated = validateUpload({
    filename: input.filename,
    declaredContentType: input.contentType,
    data: input.data,
  });

  const created = await FileModel.create({
    user: toObjectId(actor.id),
    displayName: validated.displayName,
    kind: validated.kind,
    contentType: DOCUMENT_STORAGE_CONTENT_TYPE[validated.kind],
    sizeBytes: input.data.byteLength,
    status: 'processing',
    storageKey: null,
    text: '',
    tables: [],
    chunks: [],
  });

  const fileId = String(created._id);
  const storageKey = storageKeyFor(fileId, validated.kind);
  const startedAt = Date.now();
  let stored = false;

  try {
    await getFileStorage().put(
      storageKey,
      input.data,
      DOCUMENT_STORAGE_CONTENT_TYPE[validated.kind],
    );
    stored = true;

    const extraction = await EXTRACTORS[validated.kind].extract(input.data);
    const chunks = buildChunks(extraction);

    const updated = await FileModel.findOneAndUpdate(
      { _id: created._id },
      {
        $set: {
          status: 'ready',
          storageKey,
          text: extraction.text,
          tables: extraction.tables,
          chunks,
          summary: summarise(validated.kind, extraction),
          failureReason: null,
        },
      },
      { returnDocument: 'after' },
    )
      .lean<FileDocument | null>()
      .exec();

    log.info(
      {
        fileId,
        userId: actor.id,
        kind: validated.kind,
        sizeBytes: input.data.byteLength,
        // Never the content: a document is the person's business, and a log is
        // the wrong place for it. Its shape is not.
        textChars: extraction.text.length,
        tables: extraction.tables.length,
        chunks: chunks.length,
        durationMs: Date.now() - startedAt,
        outcome: 'ready',
      },
      'document processed',
    );

    if (!updated) {
      throw new ExtractionError('Fayl saqlanmadi.');
    }

    return updated;
  } catch (error) {
    const reason =
      error instanceof ExtractionError || error instanceof ApiError
        ? error.message
        : 'Fayldan ma’lumot o‘qib bo‘lmadi.';

    log.warn(
      {
        fileId,
        userId: actor.id,
        kind: validated.kind,
        durationMs: Date.now() - startedAt,
        outcome: 'failed',
        err: error,
      },
      'document processing failed',
    );

    // The bytes are dropped rather than kept: nothing can read them, and an
    // object nobody will ever fetch is an orphan by another name.
    if (stored) {
      await getFileStorage()
        .delete(storageKey)
        .catch(() => undefined);
    }

    await FileModel.updateOne(
      { _id: created._id },
      { $set: { status: 'failed', failureReason: reason, storageKey: null } },
    ).exec();

    throw ApiError.badRequest(reason);
  }
};

export interface ListFilesQuery {
  page: number;
  pageSize: number;
}

export const listFiles = async (
  actor: AuthenticatedUser,
  query: ListFilesQuery,
): Promise<PaginatedResult<FileDocument>> => {
  const filter = ownedBy(actor, { status: { $ne: 'deleted' } });
  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    FileModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      // The extracted content is deliberately excluded from a listing: it can
      // be megabytes, and nothing rendering a list of files needs it.
      .select('-text -tables -chunks')
      .lean<FileDocument[]>()
      .exec(),
    FileModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const getFile = async (actor: AuthenticatedUser, id: string): Promise<FileDocument> => {
  const file = await FileModel.findOne(ownedBy(actor, { _id: id, status: { $ne: 'deleted' } }))
    .lean<FileDocument | null>()
    .exec();

  if (!file) {
    // Somebody else's document is reported as missing rather than forbidden: a
    // 403 would confirm the id exists, which is itself a leak.
    throw ApiError.notFound('Fayl topilmadi.');
  }

  return file;
};

/** Refuses a file that is not ready, so nothing reads a half-processed one. */
export const getReadyFile = async (actor: AuthenticatedUser, id: string): Promise<FileDocument> => {
  const file = await getFile(actor, id);

  if (file.status !== 'ready') {
    throw ApiError.badRequest(
      file.status === 'failed'
        ? (file.failureReason ?? 'Bu fayl o‘qilmadi.')
        : 'Bu fayl hali tayyor emas.',
    );
  }

  return file;
};

export const findTable = (file: FileDocument, sheet?: string): ExtractedTable => {
  if (file.tables.length === 0) {
    throw ApiError.badRequest('Bu faylda jadval yo‘q.');
  }

  if (!sheet) {
    return file.tables[0] as ExtractedTable;
  }

  const wanted = sheet.trim().toLowerCase();
  const found = file.tables.find((table) => table.name.trim().toLowerCase() === wanted);

  if (!found) {
    throw ApiError.badRequest(
      `"${sheet}" varag‘i topilmadi. Mavjud varaqlar: ${file.tables.map((table) => table.name).join(', ')}.`,
    );
  }

  return found;
};

export const searchFile = (file: FileDocument, query: string): DocumentSearchHit[] =>
  searchChunks(file.chunks, query);

/**
 * Removes a document and everything derived from it.
 *
 * The bytes go, the extraction goes, and the row is marked deleted rather than
 * dropped — so a conversation that still refers to the file gets "that file was
 * deleted" instead of a confusing silence. Storage is cleared before the row is
 * updated: an object left behind after its record is gone is unreachable and
 * therefore uncollectable.
 */
export const deleteFile = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<{ deleted: boolean }> => {
  const file = await getFile(actor, id);

  if (file.storageKey) {
    await getFileStorage()
      .delete(file.storageKey)
      .catch((error: unknown) => {
        // A missing object must not stop the record being cleared, or the file
        // becomes impossible to delete.
        log.warn({ fileId: id, err: error }, 'stored document could not be removed');
      });
  }

  await FileModel.updateOne(
    { _id: file._id },
    {
      $set: {
        status: 'deleted',
        storageKey: null,
        text: '',
        tables: [],
        chunks: [],
        summary: null,
      },
    },
  ).exec();

  log.info({ fileId: id, userId: actor.id }, 'document deleted');

  return { deleted: true };
};

/** The bytes, for an authenticated download. Never a path, never a raw URL. */
export const readFileContents = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<{ file: FileDocument; data: Buffer }> => {
  const file = await getReadyFile(actor, id);

  if (!file.storageKey) {
    throw ApiError.notFound('Fayl topilmadi.');
  }

  const object = await getFileStorage().read(file.storageKey);

  return { file, data: object.data };
};
