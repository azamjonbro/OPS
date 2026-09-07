import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../app.js';
import { config } from '../config/index.js';
import { HTTP_STATUS } from '../core/http/http-status.js';
import { parseMcpServerUrl } from '../modules/integrations/mcp/mcp-url.js';
import { ApiError } from '../core/http/api-error.js';
import { clearTestDatabase, startTestDatabase, stopTestDatabase } from '../test/database.js';
import { createTestBranch, signInAs } from '../test/factories.js';

/**
 * What the network sees, and what Hadiya will connect to.
 *
 * Three separate things live here because they share a subject rather than a
 * mechanism: which origins a browser is allowed to read a response from, which
 * headers every response carries, and which addresses a user-supplied server
 * URL may point at. The last is the one that lets an ordinary form field become
 * a request made from inside the deployment's own network.
 */
const app = createApp();

beforeAll(startTestDatabase);
afterAll(stopTestDatabase);
beforeEach(clearTestDatabase);

describe('cross-origin access', () => {
  it('does not hand an unlisted origin permission to read the response', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    for (const origin of [
      'https://evil.example',
      'null',
      'http://localhost:5173.evil.example',
      // A prefix of an allowed origin, and an allowed origin as a prefix.
      'http://localhost:51730',
      'http://localhost',
    ]) {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('origin', origin)
        .set('authorization', authorization);

      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    }
  });

  it('answers a configured origin, and only with credentials for that one', async () => {
    const allowed = config.http.corsOrigins[0];

    expect(allowed).toBeDefined();

    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('origin', allowed as string)
      .set('authorization', authorization);

    expect(response.headers['access-control-allow-origin']).toBe(allowed);
    // Never the wildcard: it is meaningless with credentials and dangerous
    // without.
    expect(response.headers['access-control-allow-origin']).not.toBe('*');
  });
});

describe('the headers every response carries', () => {
  it('sends the protective set, and does not name the server', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    const response = await request(app).get('/api/v1/auth/me').set('authorization', authorization);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBeDefined();
    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['content-security-policy']).toContain("object-src 'none'");
    expect(response.headers['x-frame-options']).toBeDefined();
    expect(response.headers['strict-transport-security']).toContain('max-age=');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('the addresses an MCP server URL may point at', () => {
  const refuses = (value: string): void => {
    expect(() => parseMcpServerUrl(value)).toThrow(ApiError);
  };

  it('refuses everything that resolves inside the deployment', () => {
    // The classic targets, in the notations they are usually written in.
    for (const url of [
      'https://127.0.0.1/mcp',
      'https://127.1/mcp',
      'https://localhost/mcp',
      'https://LOCALHOST/mcp',
      'https://something.localhost/mcp',
      'https://[::1]/mcp',
      'https://[::ffff:127.0.0.1]/mcp',
      'https://0.0.0.0/mcp',
      // Cloud instance metadata, which is where credentials live.
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.internal/computeMetadata/v1/',
      // Private ranges and carrier-grade NAT.
      'https://10.0.0.5/mcp',
      'https://172.16.4.4/mcp',
      'https://172.31.255.1/mcp',
      'https://192.168.1.1/mcp',
      'https://100.64.0.1/mcp',
      'https://[fd00::1]/mcp',
      'https://[fe80::1]/mcp',
    ]) {
      refuses(url);
    }
  });

  it('refuses a scheme that is not https', () => {
    for (const url of [
      'http://example.com/mcp',
      'file:///etc/passwd',
      'ftp://example.com/mcp',
      'gopher://example.com/',
      'ws://example.com/mcp',
      'data:text/plain,hello',
    ]) {
      refuses(url);
    }
  });

  it('refuses credentials smuggled into the authority', () => {
    // The `@` trick: everything before it is a userinfo section, so a careless
    // reader sees `example.com` and the request goes to `evil.example`.
    refuses('https://user:password@example.com/mcp');
    refuses('https://token@example.com/mcp');
  });

  it('refuses something that is not a URL at all', () => {
    for (const value of ['', '   ', 'not a url', 'https://', '//example.com/mcp', 'javascript:1']) {
      refuses(value);
    }
  });

  it('accepts an ordinary public server, and drops the fragment', () => {
    const url = parseMcpServerUrl('  https://mcp.example.com/v1/sse#anchor  ');

    expect(url.protocol).toBe('https:');
    expect(url.hostname).toBe('mcp.example.com');
    expect(url.hash).toBe('');
  });
});

describe('the budgets on endpoints that cost money', () => {
  it('bounds how many turns one account may start', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));
    const limit = config.http.endpointLimits.chatMax;
    const statuses: number[] = [];

    for (let attempt = 0; attempt < limit + 3; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/ai/chat')
        .set('authorization', authorization)
        .send({ message: `question ${attempt}` });

      statuses.push(response.status);
    }

    // No AI provider is configured in a test run, so the turns themselves fail;
    // what is under test is that the limiter refuses them before they are even
    // attempted once the budget is gone.
    expect(statuses.at(-1)).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('bounds how many documents one account may push through the parsers', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));
    const limit = config.http.endpointLimits.uploadMax;
    const statuses: number[] = [];

    for (let attempt = 0; attempt < limit + 3; attempt += 1) {
      const response = await request(app)
        .post('/api/v1/files')
        .set('authorization', authorization)
        .attach('file', Buffer.from(`a,b\n${attempt},2\n`), {
          filename: `f${attempt}.csv`,
          contentType: 'text/csv',
        });

      statuses.push(response.status);
    }

    expect(statuses.at(-1)).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('counts a budget against the account rather than the address', async () => {
    const branch = await createTestBranch();
    const heavy = await signInAs(app, 'owner', String(branch._id));
    const bystander = await signInAs(app, 'owner', String(branch._id));

    for (let attempt = 0; attempt < config.http.endpointLimits.chatMax + 2; attempt += 1) {
      await request(app)
        .post('/api/v1/ai/chat')
        .set('authorization', heavy.authorization)
        .send({ message: 'again' });
    }

    // Same address, different account: a shop's staff share one connection, and
    // one person's stuck client must not silence everybody else's.
    const response = await request(app)
      .post('/api/v1/ai/chat')
      .set('authorization', bystander.authorization)
      .send({ message: 'my turn' });

    expect(response.status).not.toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
  });

  it('cannot be widened by claiming a different address in a header', async () => {
    const branch = await createTestBranch();
    const { authorization } = await signInAs(app, 'owner', String(branch._id));

    for (let attempt = 0; attempt < config.http.endpointLimits.chatMax + 2; attempt += 1) {
      await request(app)
        .post('/api/v1/ai/chat')
        .set('authorization', authorization)
        .send({ message: 'again' });
    }

    for (const header of ['x-forwarded-for', 'x-real-ip', 'forwarded', 'x-client-ip']) {
      const response = await request(app)
        .post('/api/v1/ai/chat')
        .set('authorization', authorization)
        .set(header, `10.0.0.${Math.floor(Math.random() * 250) + 1}`)
        .send({ message: 'a fresh address, allegedly' });

      expect(response.status).toBe(HTTP_STATUS.TOO_MANY_REQUESTS);
    }
  });
});
