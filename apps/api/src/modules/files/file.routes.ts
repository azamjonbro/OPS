import { UPLOAD_RATE_LIMIT } from '@hadiya/shared';
import { Router } from 'express';

import { config } from '../../config/index.js';
import { asyncHandler } from '../../core/http/async-handler.js';
import { uploadDocument } from '../../core/http/upload.js';
import { actorRateLimiter } from '../../core/middleware/rate-limit.js';
import { validated } from '../../core/middleware/validate.js';
import * as fileController from './file.controller.js';
import { fileIdParamSchema, listFilesQuerySchema } from './file.validators.js';

/**
 * A person's own documents. Every query in the service is scoped to the actor,
 * so no role check applies and none would help: nothing here belongs to anybody
 * else, and a download resolves ownership before it reads a byte.
 */
export const fileRouter: Router = Router();

fileRouter.post(
  '/',
  // Counted before the upload is parsed, so a flood is refused without any of
  // it being read into memory. One file is bounded by `FILE_LIMITS`; this is
  // what bounds how many of them arrive, and with them how much spreadsheet and
  // PDF parsing this process is asked to do.
  actorRateLimiter({
    windowMs: UPLOAD_RATE_LIMIT.windowMs,
    max: config.http.endpointLimits.uploadMax,
    message: 'Bir vaqtning o‘zida juda ko‘p fayl yuborildi. Biroz kuting.',
  }),
  uploadDocument(),
  asyncHandler(fileController.upload),
);
fileRouter.get('/', ...validated({ query: listFilesQuerySchema }, fileController.list));
fileRouter.get('/:id', ...validated({ params: fileIdParamSchema }, fileController.detail));
fileRouter.get(
  '/:id/download',
  ...validated({ params: fileIdParamSchema }, fileController.download),
);
fileRouter.delete('/:id', ...validated({ params: fileIdParamSchema }, fileController.remove));
