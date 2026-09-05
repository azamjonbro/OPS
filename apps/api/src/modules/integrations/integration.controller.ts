import type { Request, Response } from 'express';

import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as connectService from './integration.connect.service.js';
import {
  toAuditEntryView,
  toIntegrationDetailView,
  toIntegrationView,
} from './integration.mapper.js';
import * as auditService from './integration.audit.service.js';
import * as integrationService from './integration.service.js';
import { listProviderCatalogue } from './providers/index.js';
import type {
  createIntegrationSchema,
  integrationIdParamSchema,
  listAuditQuerySchema,
  listIntegrationsQuerySchema,
  setToolPermissionSchema,
  toolParamSchema,
  updateIntegrationSchema,
} from './integration.validators.js';

/**
 * The Integration Hub's HTTP surface.
 *
 * Thin by design, like every other controller here: read the actor from the
 * authenticated request, call the service, map the result through
 * `integration.mapper.ts`. The mapper is not optional politeness — it is what
 * guarantees no response carries a credential — so no handler here ever returns
 * a document directly.
 */

const detailView = async (
  document: Parameters<typeof toIntegrationDetailView>[0],
): Promise<ReturnType<typeof toIntegrationDetailView>> =>
  toIntegrationDetailView(document, await integrationService.describeCredentials(document));

export const list: ValidatedHandler<{ query: typeof listIntegrationsQuerySchema }> = async (
  req,
  res,
) => {
  const actor = requireActor(req);
  const result = await integrationService.listIntegrations(actor, req.validated.query);

  sendPaginated(req, res, {
    items: await Promise.all(
      result.items.map(async (item) =>
        toIntegrationView(item, await integrationService.describeCredentials(item)),
      ),
    ),
    pagination: result.pagination,
  });
};

/** What the "add integration" screen may offer, and what it may not. */
export const catalogue = (req: Request, res: Response): void => {
  sendSuccess(req, res, { items: listProviderCatalogue() });
};

export const create: ValidatedHandler<{ body: typeof createIntegrationSchema }> = async (
  req,
  res,
) => {
  const created = await integrationService.createIntegration(requireActor(req), req.validated.body);

  sendCreated(req, res, await detailView(created));
};

export const detail: ValidatedHandler<{ params: typeof integrationIdParamSchema }> = async (
  req,
  res,
) => {
  const found = await integrationService.getOwnedIntegration(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, await detailView(found));
};

export const update: ValidatedHandler<{
  params: typeof integrationIdParamSchema;
  body: typeof updateIntegrationSchema;
}> = async (req, res) => {
  const updated = await integrationService.updateIntegration(
    requireActor(req),
    req.validated.params.id,
    req.validated.body,
  );

  sendSuccess(req, res, await detailView(updated));
};

export const remove: ValidatedHandler<{ params: typeof integrationIdParamSchema }> = async (
  req,
  res,
) => {
  await integrationService.deleteIntegration(requireActor(req), req.validated.params.id);

  sendNoContent(res);
};

/**
 * Tests the connection.
 *
 * A failed probe is a 200 carrying the diagnosis, not a 503: the caller asked
 * "does this work?", and "no, because the server refused the token" is the
 * answer to that question rather than a failure to answer it.
 */
export const test: ValidatedHandler<{ params: typeof integrationIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await connectService.testIntegration(requireActor(req), req.validated.params.id);

  sendSuccess(req, res, {
    health: result.health,
    integration: await detailView(result.integration),
  });
};

export const connect: ValidatedHandler<{ params: typeof integrationIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await connectService.connectIntegration(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, {
    health: result.health,
    integration: await detailView(result.integration),
  });
};

export const disconnect: ValidatedHandler<{ params: typeof integrationIdParamSchema }> = async (
  req,
  res,
) => {
  const updated = await connectService.disconnectIntegration(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, await detailView(updated));
};

export const refresh: ValidatedHandler<{ params: typeof integrationIdParamSchema }> = async (
  req,
  res,
) => {
  const result = await connectService.refreshIntegrationTools(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, {
    health: result.health,
    integration: await detailView(result.integration),
  });
};

export const setToolPermission: ValidatedHandler<{
  params: typeof toolParamSchema;
  body: typeof setToolPermissionSchema;
}> = async (req, res) => {
  const updated = await integrationService.setToolPermission(
    requireActor(req),
    req.validated.params.id,
    req.validated.params.tool,
    req.validated.body.permission,
  );

  sendSuccess(req, res, await detailView(updated));
};

export const activity: ValidatedHandler<{ query: typeof listAuditQuerySchema }> = async (
  req,
  res,
) => {
  const result = await auditService.listIntegrationEvents(requireActor(req), req.validated.query);

  sendPaginated(req, res, {
    items: result.items.map(toAuditEntryView),
    pagination: result.pagination,
  });
};
