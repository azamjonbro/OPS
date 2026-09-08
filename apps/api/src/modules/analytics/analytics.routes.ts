import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as analyticsController from './analytics.controller.js';
import { dashboardQuerySchema } from './analytics.validators.js';

/**
 * The numbers, for a screen rather than for the assistant.
 *
 * No role check: every read is scoped to the actor exactly as the assistant's
 * analytics tools are, and the shop scope comes from `BILLZ_SHOP_IDS` rather
 * than from anything a request may say. A manager and an owner see the same
 * figures here because they are the same figures.
 */
export const analyticsRouter: Router = Router();

analyticsRouter.get(
  '/dashboard',
  ...validated({ query: dashboardQuerySchema }, analyticsController.dashboard),
);
