import { SignJWT } from 'jose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { HTTP_STATUS } from '../core/http/http-status.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../test/database.js';
import { createTestBranch, createTestUser, signInAs, TEST_PASSWORD } from '../test/factories.js';

/**
 * Attacks on the front door.
 *
 * The rest of the suite asks whether Hadiya does what it is for. This file asks
 * what happens when somebody is trying to get in: a forged token, a token of
 * the wrong kind, a token whose subject was never an account, and a password
 * guessed a thousand times.
 *
 * Every one of these is written as the attack rather than as the guard, so it
 * keeps meaning something if the guard moves. `alg: none` is refused because
 * the algorithm list is pinned, but the test says "a token claiming no
 * signature does not get in", which stays true however that is achieved.
 */
const app = createApp();
const encoder = new TextEncoder();
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? '';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? '';

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

/** A token that is valid in every respect the test is not attacking. */
const mint = (options: {
  secret: string;
  subject: string;
  typ?: string;
  issuer?: string;
  expiresAt?: number;
  issuedAt?: number;
}): Promise<string> => {
  const builder = new SignJWT({ typ: options.typ ?? 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(options.subject)
    .setIssuer(options.issuer ?? 'hadiya-api')
    .setIssuedAt(options.issuedAt ?? Math.floor(Date.now() / 1_000))
    .setExpirationTime(options.expiresAt ?? Math.floor(Date.now() / 1_000) + 3_600);

  return builder.sign(encoder.encode(options.secret));
};

const me = (token: string): request.Test =>
  request(app).get('/api/v1/auth/me').set('authorization', `Bearer ${token}`);

describe('the authentication guard under attack', () => {
  it('refuses a request carrying no token at all', async () => {
    const response = await request(app).get('/api/v1/auth/me');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses a bearer header with nothing after it', async () => {
    const response = await request(app).get('/api/v1/auth/me').set('authorization', 'Bearer    ');

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses a token that is not a token', async () => {
    for (const nonsense of ['abc', 'a.b', 'a.b.c', '...', '{}']) {
      expect((await me(nonsense)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    }
  });

  it('refuses a token that claims to need no signature', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));
    const payload = authorization.slice('Bearer '.length).split('.')[1] ?? '';
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');

    expect((await me(`${header}.${payload}.`)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses a token whose signature has been edited', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));
    const [header, payload] = authorization.slice('Bearer '.length).split('.');

    expect((await me(`${header}.${payload}.${'A'.repeat(43)}`)).status).toBe(
      HTTP_STATUS.UNAUTHORIZED,
    );
  });

  it('refuses a token signed with the wrong one of its own secrets', async () => {
    const user = await createTestUser('owner', null);
    // Forged with the refresh secret. The two must not be interchangeable, or
    // a leaked refresh secret would also mint access tokens.
    const token = await mint({ secret: REFRESH_SECRET, subject: String(user._id) });

    expect((await me(token)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses a refresh token presented as an access token, and the reverse', async () => {
    const user = await createTestUser('owner', null);
    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD });

    const { accessToken, refreshToken } = login.body.data.tokens as {
      accessToken: string;
      refreshToken: string;
    };

    expect((await me(refreshToken)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(
      (await request(app).post('/api/v1/auth/refresh').send({ refreshToken: accessToken })).status,
    ).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses an expired token, and says only that', async () => {
    const user = await createTestUser('owner', null);
    const now = Math.floor(Date.now() / 1_000);
    const token = await mint({
      secret: ACCESS_SECRET,
      subject: String(user._id),
      issuedAt: now - 7_200,
      expiresAt: now - 3_600,
    });

    const response = await me(token);

    expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
    expect(response.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a token minted by somebody else claiming to be this issuer', async () => {
    const user = await createTestUser('owner', null);
    const token = await mint({
      secret: ACCESS_SECRET,
      subject: String(user._id),
      issuer: 'not-hadiya',
    });

    expect((await me(token)).status).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('refuses a validly signed token whose subject was never an account id', async () => {
    // Regression: this used to reach Mongoose, which raised a cast error, and
    // the caller got a 400 naming an internal field instead of a 401. A token
    // is either good enough to identify somebody or it is not.
    for (const subject of ['not-an-object-id', '../../etc/passwd', '{"$ne":null}', '']) {
      const token = await mint({ secret: ACCESS_SECRET, subject: subject || 'x' });
      const response = await me(token);

      expect(response.status).toBe(HTTP_STATUS.UNAUTHORIZED);
      expect(JSON.stringify(response.body)).not.toContain('_id');
    }
  });

  it('refuses a token for an account that has since been suspended', async () => {
    const branch = await createTestBranch();
    const { user, authorization } = await signInAs(app, 'manager', String(branch._id));

    expect(
      (await request(app).get('/api/v1/auth/me').set('authorization', authorization)).status,
    ).toBe(HTTP_STATUS.OK);

    user.status = 'suspended';
    await user.save();

    // The account is re-read on every request, so the token stops working at
    // once rather than when it happens to expire.
    expect(
      (await request(app).get('/api/v1/auth/me').set('authorization', authorization)).status,
    ).toBe(HTTP_STATUS.UNAUTHORIZED);
  });

  it('never answers a login with a password hash or a secret', async () => {
    const user = await createTestUser('owner', null);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: user.username, password: TEST_PASSWORD });

    const body = JSON.stringify(response.body);

    expect(body).not.toContain('passwordHash');
    expect(body).not.toContain('scrypt$');
    expect(body).not.toContain(ACCESS_SECRET);
    expect(body).not.toContain(REFRESH_SECRET);
  });

  it('refuses an operator-shaped login body rather than running it as a query', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: { $ne: null }, password: { $ne: null } });

    expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
  });
});

describe('brute force', () => {
  it('shuts the door after a run of wrong passwords', async () => {
    const user = await createTestUser('owner', null);
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: `wrong-${attempt}` });

      statuses.push(response.status);
    }

    // Regression: every one of these used to be answered `401`, for ever.
    expect(statuses).toContain(HTTP_STATUS.TOO_MANY_REQUESTS);
    expect(statuses.at(-1)).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('does not let one account being guessed lock out another', async () => {
    const victim = await createTestUser('owner', null);
    const bystander = await createTestUser('manager', String((await createTestBranch())._id));

    for (let attempt = 0; attempt < 15; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/login')
        .send({ username: victim.username, password: `wrong-${attempt}` });
    }

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: bystander.username, password: TEST_PASSWORD });

    expect(response.status).toBe(HTTP_STATUS.OK);
  });

  it('does not spend the budget on people who type their password correctly', async () => {
    const user = await createTestUser('owner', null);

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ username: user.username, password: TEST_PASSWORD });

      expect(response.status).toBe(HTTP_STATUS.OK);
    }
  });
});
