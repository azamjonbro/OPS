import { sendCreated, sendPaginated } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as inventoryService from './inventory.service.js';
import type {
  listMovementsQuerySchema,
  listStockQuerySchema,
  recordMovementSchema,
  transferStockSchema,
} from './inventory.validators.js';

export const recordMovement: ValidatedHandler<{ body: typeof recordMovementSchema }> = async (
  req,
  res,
) => {
  const { body } = req.validated;
  const result = await inventoryService.recordManualMovement(requireActor(req), {
    productId: body.productId,
    branchId: body.branchId ?? null,
    type: body.type,
    quantity: body.quantity,
    note: body.note ?? null,
    ...(body.occurredAt ? { occurredAt: body.occurredAt } : {}),
  });

  sendCreated(req, res, result);
};

export const transfer: ValidatedHandler<{ body: typeof transferStockSchema }> = async (
  req,
  res,
) => {
  const { body } = req.validated;
  const result = await inventoryService.transferStock(requireActor(req), {
    productId: body.productId,
    fromBranchId: body.fromBranchId,
    toBranchId: body.toBranchId,
    quantity: body.quantity,
    note: body.note ?? null,
  });

  sendCreated(req, res, result);
};

export const listStock: ValidatedHandler<{ query: typeof listStockQuerySchema }> = async (
  req,
  res,
) => {
  const result = await inventoryService.listStock(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const listMovements: ValidatedHandler<{ query: typeof listMovementsQuerySchema }> = async (
  req,
  res,
) => {
  const result = await inventoryService.listMovements(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};
