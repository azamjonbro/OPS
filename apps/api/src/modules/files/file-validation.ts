import {
  DOCUMENT_CONTENT_TYPES,
  DOCUMENT_EXTENSIONS,
  DOCUMENT_KINDS,
  DOCUMENT_MAGIC_BYTES,
  FILE_LIMITS,
  type DocumentKind,
} from '@hadiya/shared';

import { ApiError } from '../../core/http/api-error.js';

/**
 * Deciding what an upload actually is.
 *
 * Three independent claims are checked and all three must agree: the content
 * type the browser declared, the extension on the name, and the file's own
 * first bytes. The first two are attacker-controlled — a `.exe` renamed to
 * `.pdf` and posted with `application/pdf` satisfies both — so the bytes are
 * what the decision finally rests on.
 *
 * The filename is never used as a path. It is sanitised for *display* and
 * nothing else; the storage key is built server-side from the document's own
 * id, so there is no arrangement of dots and slashes in a name that can reach
 * the filesystem.
 */

/** `report (final).v2.XLSX` → `xlsx`. Never the whole name, never a path. */
export const extensionOf = (filename: string): string => {
  // Anything before the last dot is discarded, so `x.pdf.exe` yields `exe`
  // rather than being fooled by the first extension in the name.
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const dot = base.lastIndexOf('.');

  return dot <= 0
    ? ''
    : base
        .slice(dot + 1)
        .trim()
        .toLowerCase();
};

/**
 * A name that is safe to put on a screen.
 *
 * Path separators, control characters and leading dots are removed, and the
 * result is bounded. This is presentation only — nothing downstream may join it
 * onto a directory — but a name is still rendered in a browser and read back by
 * a model, so it should not be able to carry a newline or a directory climb.
 */
export const sanitiseDisplayName = (filename: string): string => {
  const base = filename.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    // Control characters, including the newline that would let a filename
    // inject a second line into anything that renders or logs it.
    // eslint-disable-next-line no-control-regex -- stripping them is the point
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/^\.+/, '')
    .trim();

  return cleaned.slice(0, 160) || 'document';
};

const startsWith = (data: Buffer, signature: readonly number[]): boolean =>
  data.length >= signature.length && signature.every((byte, index) => data[index] === byte);

/**
 * Whether a buffer is plausibly text.
 *
 * A NUL byte in the first few kilobytes is the practical tell: real UTF-8 text
 * does not contain one, and every binary format this rejects does. Cheap, and
 * it catches the case the magic-byte table cannot — a binary posted as `.txt`,
 * which has no signature to check against.
 */
export const looksLikeText = (data: Buffer): boolean => {
  const sample = data.subarray(0, 8_192);

  return !sample.includes(0);
};

export interface ValidatedUpload {
  kind: DocumentKind;
  displayName: string;
  extension: string;
}

const kindForExtension = (extension: string): DocumentKind | null =>
  DOCUMENT_KINDS.find((kind) =>
    (DOCUMENT_EXTENSIONS[kind] as readonly string[]).includes(extension),
  ) ?? null;

/**
 * Refuses anything that is not a document this server can actually read.
 *
 * Every refusal is a sentence a person can act on. None of them names a parser,
 * a path or a byte offset: the caller has done something wrong or unsupported,
 * and telling them which internal check failed helps an attacker far more than
 * it helps them.
 */
export const validateUpload = (input: {
  filename: string;
  declaredContentType: string;
  data: Buffer;
}): ValidatedUpload => {
  if (input.data.byteLength > FILE_LIMITS.maxBytes) {
    throw ApiError.badRequest('Fayl hajmi ruxsat etilgan limitdan katta.');
  }

  const displayName = sanitiseDisplayName(input.filename);
  const extension = extensionOf(input.filename);
  const kind = kindForExtension(extension);

  // The kind is settled before the size floor, so somebody who uploaded a `.exe`
  // is told the type is unsupported rather than that their file is empty —
  // the first is something they can act on, the second is a puzzle.
  if (!kind) {
    throw ApiError.badRequest('Bu fayl turi qo‘llab-quvvatlanmaydi.');
  }

  if (input.data.byteLength < FILE_LIMITS.minBytes) {
    throw ApiError.badRequest('Bu fayl bo‘sh.');
  }

  // The declared type must be one the browsers actually send for this kind.
  // Checked against the extension's kind rather than used to pick it, so a
  // misleading type cannot select a different parser.
  const declared = input.declaredContentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const allowed = DOCUMENT_CONTENT_TYPES[kind] as readonly string[];

  if (declared.length > 0 && !allowed.includes(declared)) {
    throw ApiError.badRequest('Fayl turi va kengaytmasi mos kelmadi.');
  }

  const signature = DOCUMENT_MAGIC_BYTES[kind];

  if (signature) {
    if (!startsWith(input.data, signature)) {
      // The name and the declared type both said one thing and the bytes say
      // another. This is the check that catches a renamed executable.
      throw ApiError.badRequest('Fayl mazmuni kengaytmasiga mos kelmadi.');
    }
  } else if (!looksLikeText(input.data)) {
    throw ApiError.badRequest('Fayl mazmuni kengaytmasiga mos kelmadi.');
  }

  return { kind, displayName, extension };
};

/**
 * The key some bytes are stored under.
 *
 * Built entirely from the document's own id, which the database generated. No
 * part of it comes from the upload, so there is nothing here for a filename to
 * influence — and it satisfies the storage layer's own key pattern, which
 * refuses anything else regardless.
 */
export const storageKeyFor = (fileId: string, kind: DocumentKind): string =>
  `documents/${fileId.toLowerCase()}.${kind}`;
