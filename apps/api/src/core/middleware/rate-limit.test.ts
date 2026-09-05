import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { errorHandler } from './error-handler.js';
import { actorRateLimiter } from './rate-limit.js';
import { requestContext } from './request-context.js';
import { sendSuccess } from '../http/api-response.js';
import { HTTP_STATUS } from '../http/http-status.js';

/**
 * The per-account limit that stands in front of the expensive endpoints.
 *
 * Tested directly rather than through `/transcribe`, because the suite runs
 * with dictation's ceiling raised out of the way so scripted uploads are not
 * racing a billing control. Here the ceiling is the test's own, which is the
 * only way to watch it actually refuse something.
 *
 * The case that matters most is the second one. A shop's staff share one
 * connection, so a limiter keyed by address would let one person's stuck button
 * take everybody else's microphone away — the exact failure this is meant to
 * prevent rather than cause.
 */
const buildTestApp = (max: number): express.Express => {
  const app = express();

  app.use(requestContext());

  // Stands in for `authenticate()`, which has already run by the time any
  // limiter in this codebase is reached: the header names who is asking.
  app.use((req, _res, next) => {
    const actor = req.get('x-test-actor');

    if (actor) {
      req.user = {
        id: actor,
        username: actor,
        fullName: actor,
        role: 'manager',
        branchId: null,
        timezone: 'Asia/Tashkent',
      };
    }

    next();
  });

  app.post(
    '/expensive',
    actorRateLimiter({ windowMs: 60_000, max, message: 'Slow down and try again shortly.' }),
    (req, res) => {
      sendSuccess(req, res, { ok: true });
    },
  );
  app.use(errorHandler());

  return app;
};

const post = (app: express.Express, actor: string) =>
  request(app).post('/expensive').set('x-test-actor', actor);

describe('the per-account rate limiter', () => {
  it('allows requests up to the ceiling and refuses the one after it', async () => {
    const app = buildTestApp(2);

    expect((await post(app, 'user-a')).status).toBe(HTTP_STATUS.OK);
    expect((await post(app, 'user-a')).status).toBe(HTTP_STATUS.OK);

    const refused = await post(app, 'user-a');

    expect(refused.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(refused.body.error.code).toBe('RATE_LIMITED');
  });

  it('says something a person can act on, not the name of a rule', async () => {
    const app = buildTestApp(1);

    await post(app, 'user-a');
    const refused = await post(app, 'user-a');

    expect(refused.body.error.message).toBe('Slow down and try again shortly.');
  });

  it('counts each account separately, so one heavy user cannot block a colleague', async () => {
    const app = buildTestApp(1);

    await post(app, 'user-a');
    expect((await post(app, 'user-a')).status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);

    // Same shop, same connection, different person: still served.
    expect((await post(app, 'user-b')).status).toBe(HTTP_STATUS.OK);
  });

  it('falls back to the address when a request somehow arrives unauthenticated', async () => {
    const app = buildTestApp(1);

    await request(app).post('/expensive');

    const refused = await request(app).post('/expensive');

    // No account to key on, so the address carries the count rather than every
    // anonymous request sharing one bucket — or none at all.
    expect(refused.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });
});
