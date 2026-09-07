import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import { ApiError } from '../../core/http/api-error.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as memoryService from './memory.service.js';
import type {
  createMemorySchema,
  forgetMemoryQuerySchema,
  listMemoriesQuerySchema,
  memoryIdParamSchema,
  updateMemorySchema,
} from './memory.validators.js';

export const create: ValidatedHandler<{ body: typeof createMemorySchema }> = async (req, res) => {
  const result = await memoryService.remember(requireActor(req), {
    ...req.validated.body,
    // Stated by the person themselves, so it is trusted and active at once.
    source: 'user',
    confidence: 1,
  });

  if (result.outcome === 'refused' || !result.memory) {
    // Refusing a credential is a decision about the request, not a server
    // fault, so it comes back as a 400 with the reason.
    throw ApiError.badRequest(result.message);
  }

  sendCreated(req, res, result.memory);
};

export const list: ValidatedHandler<{ query: typeof listMemoriesQuerySchema }> = async (
  req,
  res,
) => {
  const result = await memoryService.listMemories(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof memoryIdParamSchema }> = async (
  req,
  res,
) => {
  const memory = await memoryService.getMemory(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, memory);
};

export const update: ValidatedHandler<{
  params: typeof memoryIdParamSchema;
  body: typeof updateMemorySchema;
}> = async (req, res) => {
  const actor = requireActor(req);
  const existing = await memoryService.getMemory(actor, req.validated.params.id);
  const result = await memoryService.remember(actor, {
    type: existing.type,
    key: existing.key,
    value: req.validated.body.value,
    source: 'user',
    confidence: 1,
  });

  if (result.outcome === 'refused' || !result.memory) {
    throw ApiError.badRequest(result.message);
  }

  sendSuccess(req, res, result.memory);
};

export const confirm: ValidatedHandler<{ params: typeof memoryIdParamSchema }> = async (
  req,
  res,
) => {
  const memory = await memoryService.confirmMemory(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, memory);
};

export const forgetById: ValidatedHandler<{ params: typeof memoryIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await memoryService.forget(requireActor(req), { id: req.validated.params.id });

  if (result.forgotten === 0) {
    // The id named nothing this account owns. Reported as missing, like every
    // other by-id route: answering `200 { forgotten: 0 }` told a caller their
    // delete had succeeded when the record is still there and belongs to
    // somebody else — and told a client to remove a row from a screen that the
    // server had not removed from anything.
    throw ApiError.notFound('Memory not found');
  }

  sendSuccess(req, res, result);
};

export const forgetByKey: ValidatedHandler<{ query: typeof forgetMemoryQuerySchema }> = async (
  req,
  res,
) => {
  const result = await memoryService.forget(requireActor(req), req.validated.query);

  sendSuccess(req, res, result);
};
