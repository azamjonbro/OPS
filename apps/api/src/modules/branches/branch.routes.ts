import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as branchController from './branch.controller.js';
import {
  branchIdParamSchema,
  createBranchSchema,
  listBranchesQuerySchema,
  updateBranchSchema,
} from './branch.validators.js';

/** Authentication is applied once for the whole `/v1` tree in `routes/index.ts`. */
export const branchRouter: Router = Router();

branchRouter.post('/', ...validated({ body: createBranchSchema }, branchController.create));
branchRouter.get('/', ...validated({ query: listBranchesQuerySchema }, branchController.list));
branchRouter.get('/:id', ...validated({ params: branchIdParamSchema }, branchController.detail));
branchRouter.patch(
  '/:id',
  ...validated({ params: branchIdParamSchema, body: updateBranchSchema }, branchController.update),
);
branchRouter.delete(
  '/:id',
  ...validated({ params: branchIdParamSchema }, branchController.deactivate),
);
