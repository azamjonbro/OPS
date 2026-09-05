import type { Request, Response } from 'express';

import { sendPaginated, sendSuccess } from '../../core/http/api-response.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import { requireActor } from '../../core/security/actor.js';
import * as alertService from './alert.service.js';
import type {
  alertActionSchema,
  alertIdParamSchema,
  listAlertsQuerySchema,
  updateAlertPreferencesSchema,
} from './alert.validators.js';

export const list: ValidatedHandler<{ query: typeof listAlertsQuerySchema }> = async (req, res) => {
  const result = await alertService.listAlerts(requireActor(req), req.validated.query);

  sendPaginated(req, res, result);
};

/** The badge. Its own endpoint so a client can poll it without pulling the list. */
export const summary = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await alertService.summariseAlerts(requireActor(req)));
};

export const detail: ValidatedHandler<{ params: typeof alertIdParamSchema }> = async (req, res) => {
  sendSuccess(req, res, await alertService.getAlert(requireActor(req), req.validated.params.id));
};

export const act: ValidatedHandler<{
  params: typeof alertIdParamSchema;
  body: typeof alertActionSchema;
}> = async (req, res) => {
  const actor = requireActor(req);
  const { id } = req.validated.params;

  const alert =
    req.validated.body.action === 'acknowledge'
      ? await alertService.acknowledgeAlert(actor, id)
      : await alertService.dismissAlert(actor, id);

  sendSuccess(req, res, alert);
};

export const preferences = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await alertService.getPreferences(requireActor(req)));
};

export const updatePreferences: ValidatedHandler<{
  body: typeof updateAlertPreferencesSchema;
}> = async (req, res) => {
  sendSuccess(
    req,
    res,
    await alertService.updatePreferences(requireActor(req), req.validated.body),
  );
};
