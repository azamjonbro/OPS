import type { Request, Response } from 'express';

import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as imageService from './image.service.js';
import { describeImageProvider } from './providers/index.js';
import type {
  attachImageSchema,
  generateImageSchema,
  imageIdParamSchema,
  listImagesQuerySchema,
} from './image.validators.js';

export const generate: ValidatedHandler<{ body: typeof generateImageSchema }> = async (req, res) => {
  const result = await imageService.generateImages(requireActor(req), req.validated.body);

  sendCreated(req, res, result);
};

export const list: ValidatedHandler<{ query: typeof listImagesQuerySchema }> = async (req, res) => {
  const result = await imageService.listImages(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof imageIdParamSchema }> = async (req, res) => {
  const asset = await imageService.getImage(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, imageService.toView(asset));
};

/**
 * The bytes themselves.
 *
 * Authenticated like every other endpoint, which is the whole reason images are
 * not served from a static directory: a guessable public path would make a
 * private asset — an unreleased product, a draft price — readable by anyone who
 * tried enough URLs.
 *
 * It answers with the file rather than the response envelope, so an `<img>` can
 * use it directly once the client has attached its token.
 */
export const file: ValidatedHandler<{ params: typeof imageIdParamSchema }> = async (req, res) => {
  const object = await imageService.readImageFile(requireActor(req), req.validated.params.id);

  res.setHeader('content-type', object.contentType);
  res.setHeader('content-length', String(object.sizeBytes));
  // Private: a shared cache must never hold one user's image for another.
  res.setHeader('cache-control', 'private, max-age=3600');
  res.end(object.data);
};

export const attach: ValidatedHandler<{
  params: typeof imageIdParamSchema;
  body: typeof attachImageSchema;
}> = async (req, res) => {
  const asset = await imageService.attachImage(
    requireActor(req),
    req.validated.params.id,
    req.validated.body.contentItemId,
  );

  sendSuccess(req, res, asset);
};

export const remove: ValidatedHandler<{ params: typeof imageIdParamSchema }> = async (req, res) => {
  const result = await imageService.deleteImage(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, result);
};

/** Whether images can be generated at all, and by what. Holds no credential. */
export const status = (req: Request, res: Response): void => {
  sendSuccess(req, res, describeImageProvider());
};
