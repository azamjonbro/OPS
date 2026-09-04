import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import * as branchService from './branch.service.js';
import type {
  branchIdParamSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from './branch.validators.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';

type CreateSchemas = { body: typeof createBranchSchema };
type ListSchemas = { query: typeof listBranchesQuerySchema };
type DetailSchemas = { params: typeof branchIdParamSchema };
type UpdateSchemas = { params: typeof branchIdParamSchema; body: typeof updateBranchSchema };

export const create: ValidatedHandler<CreateSchemas> = async (req, res) => {
  const branch = await branchService.createBranch(requireActor(req), req.validated.body);

  sendCreated(req, res, branch);
};

export const list: ValidatedHandler<ListSchemas> = async (req, res) => {
  const result = await branchService.listBranches(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<DetailSchemas> = async (req, res) => {
  const branch = await branchService.getBranch(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, branch);
};

export const update: ValidatedHandler<UpdateSchemas> = async (req, res) => {
  const branch = await branchService.updateBranch(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, branch);
};

export const deactivate: ValidatedHandler<DetailSchemas> = async (req, res) => {
  const branch = await branchService.deactivateBranch(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, branch);
};
