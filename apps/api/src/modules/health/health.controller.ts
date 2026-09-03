import type { Request, Response } from 'express';

import { sendSuccess } from '../../core/http/api-response.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { getHealth, getLiveness } from './health.service.js';

/** `down` is the only state that makes the service unfit to serve traffic. */
const statusCodeFor = (status: string): (typeof HTTP_STATUS)[keyof typeof HTTP_STATUS] =>
  status === 'down' ? HTTP_STATUS.SERVICE_UNAVAILABLE : HTTP_STATUS.OK;

export const health = async (req: Request, res: Response): Promise<void> => {
  const payload = await getHealth();

  sendSuccess(req, res, payload, { status: statusCodeFor(payload.status) });
};

/** Liveness: the process is running. Never depends on an external system. */
export const liveness = (req: Request, res: Response): void => {
  sendSuccess(req, res, getLiveness());
};

/** Readiness: every required dependency is usable, so traffic may be routed here. */
export const readiness = async (req: Request, res: Response): Promise<void> => {
  const payload = await getHealth();

  sendSuccess(req, res, payload, {
    status: payload.status === 'ok' ? HTTP_STATUS.OK : HTTP_STATUS.SERVICE_UNAVAILABLE,
  });
};
