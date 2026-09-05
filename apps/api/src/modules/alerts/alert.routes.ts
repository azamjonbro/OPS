import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { validated } from '../../core/middleware/validate.js';
import * as alertController from './alert.controller.js';
import {
  alertActionSchema,
  alertIdParamSchema,
  listAlertsQuerySchema,
  updateAlertPreferencesSchema,
} from './alert.validators.js';

/**
 * A person's own alerts. Every query in the service is scoped to the actor, so
 * no role check applies and none would help: nothing here belongs to anybody
 * else, and evaluation — the only thing that creates an alert — is the
 * scheduler's, never a request's.
 */
export const alertRouter: Router = Router();

alertRouter.get('/', ...validated({ query: listAlertsQuerySchema }, alertController.list));
/** Literal paths are declared before `/:id` so they win the match. */
alertRouter.get('/summary', asyncHandler(alertController.summary));
alertRouter.get('/preferences', asyncHandler(alertController.preferences));
alertRouter.patch(
  '/preferences',
  ...validated({ body: updateAlertPreferencesSchema }, alertController.updatePreferences),
);
alertRouter.get('/:id', ...validated({ params: alertIdParamSchema }, alertController.detail));
alertRouter.post(
  '/:id/status',
  ...validated({ params: alertIdParamSchema, body: alertActionSchema }, alertController.act),
);
