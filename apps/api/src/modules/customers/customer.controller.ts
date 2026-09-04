import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as customerService from './customer.service.js';
import type {
  createCustomerSchema,
  customerIdParamSchema,
  listCustomersQuerySchema,
  updateCustomerSchema,
} from './customer.validators.js';

export const create: ValidatedHandler<{ body: typeof createCustomerSchema }> = async (req, res) => {
  const customer = await customerService.createCustomer(requireActor(req), req.validated.body);

  sendCreated(req, res, customer);
};

export const list: ValidatedHandler<{ query: typeof listCustomersQuerySchema }> = async (
  req,
  res,
) => {
  const result = await customerService.listCustomers(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof customerIdParamSchema }> = async (
  req,
  res,
) => {
  const customer = await customerService.getCustomer(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, customer);
};

export const update: ValidatedHandler<{
  params: typeof customerIdParamSchema;
  body: typeof updateCustomerSchema;
}> = async (req, res) => {
  const customer = await customerService.updateCustomer(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, customer);
};

export const block: ValidatedHandler<{ params: typeof customerIdParamSchema }> = async (
  req,
  res,
) => {
  const customer = await customerService.blockCustomer(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, customer);
};
