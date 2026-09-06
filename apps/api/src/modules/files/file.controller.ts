import type { Request, Response } from 'express';

import { sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { ApiError } from '../../core/http/api-error.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import { requireActor } from '../../core/security/actor.js';
import * as fileService from './file.service.js';
import type { fileIdParamSchema, listFilesQuerySchema } from './file.validators.js';

/**
 * Uploading a document.
 *
 * The multipart body is parsed by the upload middleware, which has already
 * bounded the size. Everything about what the file *is* is decided in the
 * service, from the bytes — nothing here trusts the browser's word.
 */
export const upload = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;

  if (!file) {
    throw ApiError.badRequest('Hech qanday fayl yuborilmadi.');
  }

  const created = await fileService.uploadFile(requireActor(req), {
    filename: file.originalname,
    contentType: file.mimetype,
    data: file.buffer,
  });

  // The extracted content is not echoed back: the client renders a card from
  // the summary, and the text can be megabytes.
  sendSuccess(req, res, { ...created, text: undefined, tables: undefined, chunks: undefined });
};

export const list: ValidatedHandler<{ query: typeof listFilesQuerySchema }> = async (req, res) => {
  sendPaginated(req, res, await fileService.listFiles(requireActor(req), req.validated.query));
};

export const detail: ValidatedHandler<{ params: typeof fileIdParamSchema }> = async (req, res) => {
  const file = await fileService.getFile(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, { ...file, text: undefined, tables: undefined, chunks: undefined });
};

export const remove: ValidatedHandler<{ params: typeof fileIdParamSchema }> = async (req, res) => {
  sendSuccess(req, res, await fileService.deleteFile(requireActor(req), req.validated.params.id));
};

/**
 * A `Content-Disposition` value that survives a real filename.
 *
 * An HTTP header is bytes, and only Latin-1 bytes at that. `hisobot-отчёт.csv`
 * is a perfectly ordinary name in this product's own languages, and writing it
 * into a header raw does not merely look wrong — Node emits it unencoded and
 * the response is rejected at the protocol level, so downloading the file fails
 * outright. Quotes and backslashes are the other half: unescaped, they end the
 * quoted string early and let the rest of the name be read as further header
 * parameters.
 *
 * So both forms are sent, which is what RFC 6266 asks for. The plain `filename`
 * is stripped down to safe ASCII for old clients, and `filename*` carries the
 * real name percent-encoded as UTF-8 for everything current.
 */
const contentDisposition = (displayName: string): string => {
  const ascii = displayName
    // Everything outside printable ASCII, which is what a header may hold.
    .replace(/[^\u0020-\u007e]/g, '_')
    .replace(/["\\]/g, '_');
  const fallback = ascii.trim() || 'document';

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(displayName)}`;
};

/**
 * Downloading one's own document.
 *
 * Authenticated and ownership-resolved server-side; the storage key never
 * reaches the client, so there is no URL to guess or share.
 */
export const download: ValidatedHandler<{ params: typeof fileIdParamSchema }> = async (
  req,
  res,
) => {
  const { file, data } = await fileService.readFileContents(
    requireActor(req),
    req.validated.params.id,
  );

  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Length', String(data.byteLength));
  // `attachment` rather than `inline`: a stored document is never rendered in
  // the origin, which is what would turn an uploaded HTML-ish file into script.
  res.setHeader('Content-Disposition', contentDisposition(file.displayName));
  res.send(data);
};
