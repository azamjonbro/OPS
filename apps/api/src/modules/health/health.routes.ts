import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import * as healthController from './health.controller.js';

export const healthRouter: Router = Router();

healthRouter.get('/', asyncHandler(healthController.health));
healthRouter.get('/live', healthController.liveness);
healthRouter.get('/ready', asyncHandler(healthController.readiness));
