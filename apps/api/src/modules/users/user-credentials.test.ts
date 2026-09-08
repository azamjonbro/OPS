import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestUser, signIn, signInAs, TEST_PASSWORD } from '../../test/factories.js';

/**
 * The two changes a person makes to their own account from Settings.
 *
 * What is being pinned here is the protection rather than the mechanics: both
 * endpoints must refuse an open session that cannot produce the current
 * password, because otherwise an unattended till is enough to take an account
 * over — and a rename must not end the session it was made from.
 */
const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

describe('POST /api/v1/users/:id/username', () => {
  it('renames the caller’s own login and lets them sign in with it', async () => {
    const { user, authorization } = await signInAs(app, 'owner', null);

    const response = await request(app)
      .post(`/api/v1/users/${String(user._id)}/username`)
      .set('Authorization', authorization)
      .send({ username: 'yangi.login', currentPassword: TEST_PASSWORD });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.username).toBe('yangi.login');
    // The old session keeps working: the token names the id, not the login.
    expect(
      (await request(app).get('/api/v1/conversations').set('Authorization', authorization)).status,
    ).toBe(HTTP_STATUS.OK);
    await expect(signIn(app, 'yangi.login')).resolves.toContain('Bearer ');
  });

  it('refuses a rename that cannot produce the current password', async () => {
    const { user, authorization } = await signInAs(app, 'owner', null);

    const response = await request(app)
      .post(`/api/v1/users/${String(user._id)}/username`)
      .set('Authorization', authorization)
      .send({ username: 'yangi.login', currentPassword: 'not-the-password' });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
    expect(
      (
        await request(app).post('/api/v1/auth/login').send({
          username: 'yangi.login',
          password: TEST_PASSWORD,
        })
      ).status,
    ).not.toBe(HTTP_STATUS.OK);
  });

  it('reports a login somebody else already has', async () => {
    const { user, authorization } = await signInAs(app, 'owner', null);
    const taken = await createTestUser('manager', null, { username: 'band.login' });

    const response = await request(app)
      .post(`/api/v1/users/${String(user._id)}/username`)
      .set('Authorization', authorization)
      .send({ username: taken.username, currentPassword: TEST_PASSWORD });

    expect(response.status).toBe(HTTP_STATUS.CONFLICT);
  });

  it('does not let a cashier rename somebody else', async () => {
    const { authorization } = await signInAs(app, 'cashier', null);
    const other = await createTestUser('cashier', null);

    const response = await request(app)
      .post(`/api/v1/users/${String(other._id)}/username`)
      .set('Authorization', authorization)
      .send({ username: 'boshqa.login' });

    expect(response.status).toBe(HTTP_STATUS.FORBIDDEN);
  });
});

describe('POST /api/v1/users/:id/password', () => {
  it('changes the caller’s own password', async () => {
    const { user, authorization } = await signInAs(app, 'owner', null);

    const response = await request(app)
      .post(`/api/v1/users/${String(user._id)}/password`)
      .set('Authorization', authorization)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'yangi-parol-2026' });

    expect(response.status).toBe(HTTP_STATUS.NO_CONTENT);
    expect(
      (
        await request(app).post('/api/v1/auth/login').send({
          username: user.username,
          password: 'yangi-parol-2026',
        })
      ).status,
    ).toBe(HTTP_STATUS.OK);
  });

  it('refuses a change that cannot produce the current password', async () => {
    const { user, authorization } = await signInAs(app, 'owner', null);

    const response = await request(app)
      .post(`/api/v1/users/${String(user._id)}/password`)
      .set('Authorization', authorization)
      .send({ currentPassword: 'not-the-password', newPassword: 'yangi-parol-2026' });

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});
