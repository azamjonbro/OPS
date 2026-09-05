import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { uploadDocument } from '../../core/http/upload.js';
import { validated } from '../../core/middleware/validate.js';
import * as fileController from './file.controller.js';
import { fileIdParamSchema, listFilesQuerySchema } from './file.validators.js';

/**
 * A person's own documents. Every query in the service is scoped to the actor,
 * so no role check applies and none would help: nothing here belongs to anybody
 * else, and a download resolves ownership before it reads a byte.
 */
export const fileRouter: Router = Router();

fileRouter.post('/', uploadDocument(), asyncHandler(fileController.upload));
fileRouter.get('/', ...validated({ query: listFilesQuerySchema }, fileController.list));
fileRouter.get('/:id', ...validated({ params: fileIdParamSchema }, fileController.detail));
fileRouter.get(
  '/:id/download',
  ...validated({ params: fileIdParamSchema }, fileController.download),
);
fileRouter.delete('/:id', ...validated({ params: fileIdParamSchema }, fileController.remove));
