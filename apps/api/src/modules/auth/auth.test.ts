import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../../app.js';
import { HTTP_STATUS } from '../../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../../test/database.js';
import { createTestBranch, createTestUser, TEST_PASSWORD } from '../../test/factories.js';

const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

describe('POST /api/v1/auth/login', () => {
  it('issues a token pair for valid credentials', async () => {
    const branch = await createTestBranch();
    const user = await createTestUser('cashier', String(branch._id));

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD });

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data.tokens).toMatchObject({
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
      expiresIn: expect.any(Number),
    });
    expect(response.body.data.user).toMatchObject({ username: user.username, role: 'cashier' });
    // The hash must never leave the API.
    expect(response.body.data.user.passwordHash).toBeUndefined();
  });

  it('rejects a wrong password without revealing which part failed', async () => {
    const user = await createTestUser('owner', null);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: 'not-the-password' });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(response.body.error.message).toBe('Invalid username or password');
  });

  it('gives the same answer for an account that does not exist', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nobody', password: TEST_PASSWORD });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(response.body.error.message).toBe('Invalid username or password');
  });

  it('refuses a suspended account', async () => {
    const user = await createTestUser('manager', String((await createTestBranch())._id), {
      status: 'suspended',
    });

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD });

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('authentication guard', () => {
  it('refuses a request with no token', async () => {
    const response = await request(app).get('/api/v1/conversations');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(response.body).toMatchObject({
      success: false,
      error: { code: 'UNAUTHENTICATED' },
    });
  });

  it('refuses a token that was not signed by this API', async () => {
    const response = await request(app)
      .get('/api/v1/conversations')
      .set('Authorization', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhIn0.wrong-signature');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('stops honouring a token once the account is suspended', async () => {
    const branch = await createTestBranch();
    const user = await createTestUser('manager', String(branch._id));
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD });
    const authorization = `Bearer ${login.body.data.tokens.accessToken}`;

    expect(
      (await request(app).get('/api/v1/conversations').set('Authorization', authorization)).status,
    ).toBe(HTTP_STATUS.OK);

    const { UserModel } = await import('../users/user.model.js');
    await UserModel.updateOne({ _id: user._id }, { $set: { status: 'suspended' } }).exec();

    const response = await request(app)
      .get('/api/v1/conversations')
      .set('Authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the signed-in employee', async () => {
    const branch = await createTestBranch();
    const user = await createTestUser('cashier', String(branch._id));
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD });

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.data.tokens.accessToken}`);

    expect(response.status).toBe(HTTP_STATUS.OK);
    expect(response.body.data).toMatchObject({ id: String(user._id), username: user.username });
  });
});
