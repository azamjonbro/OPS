import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { validated } from '../../core/middleware/validate.js';
import * as imageController from './image.controller.js';
import {
  attachImageSchema,
  generateImageSchema,
  imageIdParamSchema,
  listImagesQuerySchema,
} from './image.validators.js';

/**
 * A person's own images. Every query in the service is scoped to the actor, so
 * no role check applies and none would help: nothing here belongs to anyone
 * else, including the bytes.
 */
export const imageRouter: Router = Router();

imageRouter.get('/', ...validated({ query: listImagesQuerySchema }, imageController.list));
/** Literal paths are declared before `/:id` so they win the match. */
imageRouter.post('/generate', ...validated({ body: generateImageSchema }, imageController.generate));
imageRouter.get('/status', asyncHandler(async (req, res) => imageController.status(req, res)));
imageRouter.get('/:id', ...validated({ params: imageIdParamSchema }, imageController.detail));
imageRouter.get('/:id/file', ...validated({ params: imageIdParamSchema }, imageController.file));
imageRouter.post(
  '/:id/attach',
  ...validated({ params: imageIdParamSchema, body: attachImageSchema }, imageController.attach),
);
imageRouter.delete('/:id', ...validated({ params: imageIdParamSchema }, imageController.remove));
