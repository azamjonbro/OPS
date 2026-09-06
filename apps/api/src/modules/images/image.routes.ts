import { IMAGE_RATE_LIMIT } from '@hadiya/shared';
import { Router } from 'express';

import { config } from '../../config/index.js';
import { asyncHandler } from '../../core/http/async-handler.js';
import { actorRateLimiter } from '../../core/middleware/rate-limit.js';
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
imageRouter.post(
  '/generate',
  // An image is billed per picture, and the request asks for several. Counted
  // per account before anything is drawn, so a loop is refused rather than
  // invoiced.
  actorRateLimiter({
    windowMs: IMAGE_RATE_LIMIT.windowMs,
    max: config.http.endpointLimits.imageMax,
    message: 'That is a lot of images at once. Wait a moment and try again.',
  }),
  ...validated({ body: generateImageSchema }, imageController.generate),
);
imageRouter.get(
  '/status',
  asyncHandler(async (req, res) => imageController.status(req, res)),
);
imageRouter.get('/:id', ...validated({ params: imageIdParamSchema }, imageController.detail));
imageRouter.get('/:id/file', ...validated({ params: imageIdParamSchema }, imageController.file));
imageRouter.post(
  '/:id/attach',
  ...validated({ params: imageIdParamSchema, body: attachImageSchema }, imageController.attach),
);
imageRouter.delete('/:id', ...validated({ params: imageIdParamSchema }, imageController.remove));
