import { sendCreated, sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as paymentService from './payment.service.js';
import type {
  listPaymentsQuerySchema,
  paymentIdParamSchema,
  recordPaymentSchema,
} from './payment.validators.js';

export const create: ValidatedHandler<{ body: typeof recordPaymentSchema }> = async (req, res) => {
  const payment = await paymentService.recordPayment(requireActor(req), req.validated.body);

  sendCreated(req, res, payment);
};

export const list: ValidatedHandler<{ query: typeof listPaymentsQuerySchema }> = async (
  req,
  res,
) => {
  const result = await paymentService.listPayments(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof paymentIdParamSchema }> = async (
  req,
  res,
) => {
  const payment = await paymentService.getPayment(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, payment);
};

export const voidPayment: ValidatedHandler<{ params: typeof paymentIdParamSchema }> = async (
  req,
  res,
) => {
  const payment = await paymentService.voidPayment(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, payment);
};
