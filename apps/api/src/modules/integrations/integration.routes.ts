import { Router } from 'express';

import { validated } from '../../core/middleware/validate.js';
import * as integrationController from './integration.controller.js';
import {
  createIntegrationSchema,
  integrationIdParamSchema,
  listAuditQuerySchema,
  listIntegrationsQuerySchema,
  setToolPermissionSchema,
  toolParamSchema,
  updateIntegrationSchema,
} from './integration.validators.js';

/**
 * A person's own integrations, mounted at `/api/v1/integrations`.
 *
 * No role check anywhere on this router, and that is the rule rather than an
 * omission: every integration belongs to one account, every query in the
 * service is filtered by the actor, and an owner may always manage their own.
 * The same reasoning as `reminderRouter`, with a sharper edge — these rows hold
 * credentials, so the filter *is* the authorization and is written into the
 * query rather than checked afterwards.
 *
 * Billz's own read endpoints stay where they were, at
 * `/api/v1/integrations/billz`. This router is registered after it, so its
 * `/:id` cannot swallow that path — and `:id` is an ObjectId pattern, so
 * `billz` would not match it in any case.
 */
export const integrationRouter: Router = Router();

/** What the "add integration" screen may offer. Static, and never a secret. */
integrationRouter.get('/catalogue', integrationController.catalogue);

/** The audit trail. Before `/:id` so `activity` is not read as an id. */
integrationRouter.get(
  '/activity',
  ...validated({ query: listAuditQuerySchema }, integrationController.activity),
);

integrationRouter.get(
  '/',
  ...validated({ query: listIntegrationsQuerySchema }, integrationController.list),
);
integrationRouter.post(
  '/',
  ...validated({ body: createIntegrationSchema }, integrationController.create),
);

integrationRouter.get(
  '/:id',
  ...validated({ params: integrationIdParamSchema }, integrationController.detail),
);
integrationRouter.patch(
  '/:id',
  ...validated(
    { params: integrationIdParamSchema, body: updateIntegrationSchema },
    integrationController.update,
  ),
);
integrationRouter.delete(
  '/:id',
  ...validated({ params: integrationIdParamSchema }, integrationController.remove),
);

/**
 * The connection lifecycle.
 *
 * All `POST`, because every one of them reaches a server and changes stored
 * state — even `test`, which records what it found. A `GET` that opens a socket
 * to a third party is the kind of thing a browser prefetch turns into a
 * surprise.
 */
integrationRouter.post(
  '/:id/test',
  ...validated({ params: integrationIdParamSchema }, integrationController.test),
);
integrationRouter.post(
  '/:id/connect',
  ...validated({ params: integrationIdParamSchema }, integrationController.connect),
);
integrationRouter.post(
  '/:id/disconnect',
  ...validated({ params: integrationIdParamSchema }, integrationController.disconnect),
);
integrationRouter.post(
  '/:id/refresh',
  ...validated({ params: integrationIdParamSchema }, integrationController.refresh),
);

/** Per-tool permissions, the switch that decides what the model may reach. */
integrationRouter.patch(
  '/:id/tools/:tool',
  ...validated(
    { params: toolParamSchema, body: setToolPermissionSchema },
    integrationController.setToolPermission,
  ),
);
