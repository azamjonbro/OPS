import type { Request, Response } from 'express';

import { sendAccepted, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as billzService from './billz.service.js';
import type {
  billzCustomerQuerySchema,
  billzExternalIdParamSchema,
  billzInventoryQuerySchema,
  billzPeriodQuerySchema,
  billzProductQuerySchema,
  billzSalesQuerySchema,
} from './billz.validators.js';

export const status = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await billzService.getStatus(requireActor(req)));
};

export const listProducts: ValidatedHandler<{ query: typeof billzProductQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(req, res, await billzService.listProducts(requireActor(req), req.validated.query));
};

export const getProduct: ValidatedHandler<{ params: typeof billzExternalIdParamSchema }> = async (
  req,
  res,
) => {
  sendSuccess(
    req,
    res,
    await billzService.getProduct(requireActor(req), req.validated.params.externalId),
  );
};

export const listCategories = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await billzService.listCategories(requireActor(req)));
};

export const listShops = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await billzService.listShops(requireActor(req)));
};

export const listPaymentTypes = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await billzService.listPaymentTypes(requireActor(req)));
};

export const listCustomers: ValidatedHandler<{ query: typeof billzCustomerQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(req, res, await billzService.listCustomers(requireActor(req), req.validated.query));
};

export const listSales: ValidatedHandler<{ query: typeof billzSalesQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(req, res, await billzService.listSales(requireActor(req), req.validated.query));
};

export const getSale: ValidatedHandler<{ params: typeof billzExternalIdParamSchema }> = async (
  req,
  res,
) => {
  sendSuccess(
    req,
    res,
    await billzService.getSale(requireActor(req), req.validated.params.externalId),
  );
};

export const salesSummary: ValidatedHandler<{ query: typeof billzPeriodQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(req, res, await billzService.getSalesSummary(requireActor(req), req.validated.query));
};

export const paymentBreakdown: ValidatedHandler<{ query: typeof billzPeriodQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(
    req,
    res,
    await billzService.getPaymentBreakdown(requireActor(req), req.validated.query),
  );
};

export const listDebts: ValidatedHandler<{ query: typeof billzPeriodQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(req, res, await billzService.listDebts(requireActor(req), req.validated.query));
};

export const listInventory: ValidatedHandler<{ query: typeof billzInventoryQuerySchema }> = async (
  req,
  res,
) => {
  sendSuccess(req, res, await billzService.listInventory(requireActor(req), req.validated.query));
};

export const capabilities = (req: Request, res: Response): void => {
  sendSuccess(req, res, billzService.listCapabilities(requireActor(req)));
};
