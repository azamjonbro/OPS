import {
  isSupportedAudioMimeType,
  SPEECH_MAX_UPLOAD_BYTES,
  SPEECH_UPLOAD_FIELD,
} from '@hadiya/shared';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import multer from 'multer';

import { ApiError } from './api-error.js';

/**
 * Receiving an uploaded file, in memory.
 *
 * Memory storage rather than a temp directory, and that is a security decision
 * as much as a performance one: nothing is written to disk, so there is no
 * temporary file to clean up, no path to sanitise and nothing left behind when
 * a request dies halfway. A recording is a few hundred kilobytes that lives for
 * the length of one request, which is exactly what a buffer is for.
 *
 * The client-supplied filename is never used. It reaches us as untrusted text
 * and has no bearing on anything — the content type decides what the file is,
 * and the provider is handed a name this server chose.
 */
const audioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: SPEECH_MAX_UPLOAD_BYTES,
    // One field, one file: a request carrying more than that is not a
    // recording, whatever it claims to be.
    files: 1,
    fields: 4,
  },
  fileFilter: (_request, file, callback) => {
    if (!isSupportedAudioMimeType(file.mimetype)) {
      callback(
        ApiError.badRequest(
          `"${file.mimetype}" is not an audio format this server accepts.`,
        ) as unknown as Error,
      );

      return;
    }

    callback(null, true);
  },
});

const MULTER_MESSAGES: Record<string, string> = {
  LIMIT_FILE_SIZE: 'That recording is too large.',
  LIMIT_FILE_COUNT: 'Send one recording at a time.',
  LIMIT_UNEXPECTED_FILE: 'The recording was sent on an unexpected field.',
};

/**
 * Accepts one audio file and turns any upload failure into an `ApiError`.
 *
 * Multer signals its limits with its own error type, which the generic error
 * handler would report as an unexplained `500`. Translating here means an
 * oversized recording gets the `400` and the plain sentence it deserves, and
 * nothing about the parser reaches the client.
 */
export const uploadAudio = (): RequestHandler => {
  const handler = audioUpload.single(SPEECH_UPLOAD_FIELD);

  return (req: Request, res: Response, next: NextFunction) => {
    handler(req, res, (error: unknown) => {
      if (!error) {
        next();

        return;
      }

      if (error instanceof ApiError) {
        next(error);

        return;
      }

      if (error instanceof multer.MulterError) {
        next(ApiError.badRequest(MULTER_MESSAGES[error.code] ?? 'The upload could not be read.'));

        return;
      }

      next(ApiError.badRequest('The upload could not be read.'));
    });
  };
};
