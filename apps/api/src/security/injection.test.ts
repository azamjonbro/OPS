import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { HTTP_STATUS } from '../core/http/http-status.js';
import { toObjectId } from '../core/db/object-id.js';
import { MemoryModel } from '../modules/memory/memory.model.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../test/database.js';
import { createTestBranch, signInAs } from '../test/factories.js';

/**
 * What happens when a value that was meant to be text is treated as code.
 *
 * Every `search` parameter in Hadiya reaches MongoDB as a `$regex`, which makes
 * the search box a small programming language exposed to anybody with an
 * account. Two things went wrong with that and both are regression-tested here:
 * a malformed pattern took the request down with a driver error, and a
 * well-formed one ran as a pattern rather than as the words somebody typed.
 */
const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

/** Every list endpoint that accepts a free-text search. */
const SEARCHABLE = [
  '/api/v1/memory',
  '/api/v1/conversations',
  '/api/v1/reminders',
  '/api/v1/content/plans',
  '/api/v1/images',
  '/api/v1/users',
  '/api/v1/branches',
] as const;

/**
 * Patterns that are either invalid, or valid and ruinous.
 *
 * The nested quantifiers are the denial of service: matched against a real
 * collection they backtrack catastrophically, inside the database, on a thread
 * everything else is waiting for.
 */
const HOSTILE_PATTERNS = [
  '([',
  '(?',
  '*',
  '+',
  '[a-',
  '\\',
  '(a+)+(a+)+(a+)+(a+)+(a+)+(a+)+$',
  '(x+x+)+y',
  '.*'.repeat(40),
] as const;

describe('a search box is not a regular expression', () => {
  it('answers a malformed pattern without a server error, on every endpoint', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    for (const path of SEARCHABLE) {
      for (const search of HOSTILE_PATTERNS) {
        const response = await request(app)
          .get(path)
          .query({ search })
          .set('authorization', authorization);

        // Regression: `([` used to reach Mongo and come back as a 500 carrying
        // a driver message — and, outside production, a stack trace.
        expect(response.status).not.toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
        expect(JSON.stringify(response.body)).not.toContain('MongoServerError');
        expect(JSON.stringify(response.body)).not.toContain('Regular expression is invalid');
      }
    }
  });

  it('treats the search term as the characters somebody typed', async () => {
    const branch = await createTestBranch();
    const { authorization, actor } = await signInAs(app, 'owner', String(branch._id));

    await MemoryModel.create([
      {
        user: toObjectId(actor.id),
        type: 'fact',
        key: 'secret_key',
        value: 'the crown jewels',
        source: 'user',
        status: 'active',
        confidence: 1,
      },
      {
        user: toObjectId(actor.id),
        type: 'fact',
        key: 'literal_dot',
        value: 'contains secre. exactly',
        source: 'user',
        status: 'active',
        confidence: 1,
      },
    ]);

    // Regression: `.` used to be a wildcard, so this matched `secret_key`.
    const wildcard = await request(app)
      .get('/api/v1/memory')
      .query({ search: 'secre.' })
      .set('authorization', authorization);

    expect(wildcard.status).toBe(HTTP_STATUS.OK);
    expect(wildcard.body.data.items).toHaveLength(1);
    expect(wildcard.body.data.items[0].key).toBe('literal_dot');

    // And an ordinary search still works.
    const plain = await request(app)
      .get('/api/v1/memory')
      .query({ search: 'crown' })
      .set('authorization', authorization);

    expect(plain.body.data.items).toHaveLength(1);
    expect(plain.body.data.items[0].key).toBe('secret_key');
  });

  it('answers a hostile pattern promptly rather than grinding', async () => {
    const branch = await createTestBranch();
    const { authorization, actor } = await signInAs(app, 'owner', String(branch._id));

    // Enough rows that a backtracking pattern would have somewhere to work.
    await MemoryModel.insertMany(
      Array.from({ length: 200 }, (_, index) => ({
        user: toObjectId(actor.id),
        type: 'fact' as const,
        key: `note_${index}`,
        value: 'a'.repeat(120),
        source: 'user' as const,
        status: 'active' as const,
        confidence: 1,
      })),
    );

    const startedAt = Date.now();
    const response = await request(app)
      .get('/api/v1/memory')
      .query({ search: '(a+)+(a+)+(a+)+(a+)+(a+)+(a+)+$' })
      .set('authorization', authorization);

    expect(response.status).toBe(HTTP_STATUS.OK);
    // Escaped, the pattern is a literal string nothing contains, so this is a
    // plain miss rather than a search for a needle in an exponential haystack.
    expect(response.body.data.items).toHaveLength(0);
    expect(Date.now() - startedAt).toBeLessThan(5_000);
  });
});

describe('values that are meant to be data', () => {
  it('does not let an operator-shaped body become part of a query', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    for (const body of [
      { type: { $ne: null }, key: 'k', value: 'v' },
      { type: 'fact', key: { $gt: '' }, value: 'v' },
      { type: 'fact', key: 'k', value: { $where: 'sleep(5000)' } },
    ]) {
      const response = await request(app)
        .post('/api/v1/memory')
        .set('authorization', authorization)
        .send(body);

      expect(response.status).toBe(HTTP_STATUS.UNPROCESSABLE_ENTITY);
    }
  });

  it('does not let a request body reach Object.prototype', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    await request(app)
      .post('/api/v1/memory')
      .set('authorization', authorization)
      .set('content-type', 'application/json')
      .send(
        JSON.stringify({
          type: 'fact',
          key: 'k',
          value: 'v',
          __proto__: { polluted: 'yes' },
          constructor: { prototype: { alsoPolluted: 'yes' } },
        }),
      );

    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).alsoPolluted).toBeUndefined();
  });

  it('refuses a body larger than the configured limit, as a client error', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('authorization', authorization)
      .send({ title: 'x'.repeat(3_000_000) });

    // Regression: this used to be a 500 carrying a `PayloadTooLargeError`
    // stack. A limit the server chose to enforce is not a server fault.
    expect(response.status).toBe(HTTP_STATUS.PAYLOAD_TOO_LARGE);
    expect(JSON.stringify(response.body)).not.toContain('at ');
  });

  it('refuses a body that is not JSON, as a client error', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    const response = await request(app)
      .post('/api/v1/conversations')
      .set('authorization', authorization)
      .set('content-type', 'application/json')
      .send('{ not json');

    expect(response.status).toBe(HTTP_STATUS.BAD_REQUEST);
  });
});

describe('what an error is allowed to say', () => {
  it('never answers with a stack trace or a filesystem path', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    const responses = await Promise.all([
      request(app)
        .get('/api/v1/memory')
        .query({ search: '([' })
        .set('authorization', authorization),
      request(app).get('/api/v1/memory/not-an-id').set('authorization', authorization),
      request(app).get('/api/v1/nothing-here').set('authorization', authorization),
      request(app).post('/api/v1/memory').set('authorization', authorization).send({}),
    ]);

    for (const response of responses) {
      const body = JSON.stringify(response.body);

      expect(body).not.toContain('node_modules');
      expect(body).not.toContain('/Users/');
      expect(body).not.toContain('mongodb://');
      expect(body).not.toContain('MongoServerError');
      expect(response.status).not.toBe(HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }
  });

  it('never answers with a secret from the configuration', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    const secrets = [
      process.env.JWT_ACCESS_SECRET,
      process.env.JWT_REFRESH_SECRET,
      process.env.CREDENTIALS_ENCRYPTION_KEY,
      process.env.BILLZ_API_TOKEN,
    ].filter((value): value is string => Boolean(value));

    for (const path of [
      '/api/health',
      '/api/v1/auth/me',
      '/api/v1/ai/status',
      '/api/v1/ai/speech-status',
      '/api/v1/images/status',
      '/api/v1/integrations/catalogue',
    ]) {
      const response = await request(app).get(path).set('authorization', authorization);
      const body = JSON.stringify(response.body);

      for (const secret of secrets) {
        expect(body).not.toContain(secret);
      }

      expect(body).not.toContain('apiKey');
      expect(body).not.toContain('passwordHash');
    }
  });
});
