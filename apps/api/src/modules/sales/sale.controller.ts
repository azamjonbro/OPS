import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as saleService from './sale.service.js';
import type {
  cancelSaleSchema,
  createSaleSchema,
  listSalesQuerySchema,
  saleIdParamSchema,
} from './sale.validators.js';

export const create: ValidatedHandler<{ body: typeof createSaleSchema }> = async (req, res) => {
  const sale = await saleService.createSale(requireActor(req), req.validated.body);

  sendCreated(req, res, sale);
};

export const list: ValidatedHandler<{ query: typeof listSalesQuerySchema }> = async (req, res) => {
  const result = await saleService.listSales(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof saleIdParamSchema }> = async (req, res) => {
  const sale = await saleService.getSale(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, sale);
};

export const cancel: ValidatedHandler<{
  params: typeof saleIdParamSchema;
  body: typeof cancelSaleSchema;
}> = async (req, res) => {
  const sale = await saleService.cancelSale(
    requireActor(req),
    req.validated.params.id,
    req.validated.body.reason,
  );

  sendSuccess(req, res, sale);
};
