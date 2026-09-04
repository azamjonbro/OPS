import type { Request, Response } from 'express';
import type {
  ApiResponseMeta,
  ApiSuccessResponse,
  PaginatedResult,
  PaginationMeta,
} from '@hadiya/shared';

import { HTTP_STATUS, type HttpStatus } from './http-status.js';
import { toApiPayload } from './serialize.js';

export const buildResponseMeta = (req: Request): ApiResponseMeta => ({
  requestId: req.id,
  timestamp: new Date().toISOString(),
});

export interface SendSuccessOptions {
  status?: HttpStatus;
}

/**
 * The only way a controller writes a successful body, so every endpoint shares
 * one envelope shape.
 */
export const sendSuccess = <TData>(
  req: Request,
  res: Response,
  data: TData,
  options: SendSuccessOptions = {},
): void => {
  const body = {
    success: true,
    // Documents are normalised here (`_id` -> `id`) so every endpoint returns
    // the same shape whether it read lean objects or hydrated documents.
    data: toApiPayload(data),
    meta: buildResponseMeta(req),
  } satisfies Omit<ApiSuccessResponse<TData>, 'data'> & { data: unknown };

  res.status(options.status ?? HTTP_STATUS.OK).json(body);
};

export const sendCreated = <TData>(req: Request, res: Response, data: TData): void => {
  sendSuccess(req, res, data, { status: HTTP_STATUS.CREATED });
};

/** The work was accepted but is not finished — used by the sync trigger. */
export const sendAccepted = <TData>(req: Request, res: Response, data: TData): void => {
  sendSuccess(req, res, data, { status: HTTP_STATUS.ACCEPTED });
};

export const sendNoContent = (res: Response): void => {
  res.status(HTTP_STATUS.NO_CONTENT).end();
};

export interface PaginatedData<TItem> {
  items: TItem[];
  pagination: PaginationMeta;
}

export const sendPaginated = <TItem>(
  req: Request,
  res: Response,
  result: PaginatedResult<TItem>,
): void => {
  sendSuccess<PaginatedData<TItem>>(req, res, result);
};
