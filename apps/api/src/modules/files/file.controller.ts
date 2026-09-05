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
 * Downloading one's own document.
 *
 * Authenticated and ownership-resolved server-side; the storage key never
 * reaches the client, so there is no URL to guess or share. The filename is
 * sent quoted and already sanitised, so it cannot break out of the header.
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
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${file.displayName.replace(/"/g, '')}"`,
  );
  res.send(data);
};
