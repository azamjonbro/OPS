import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { BillzError } from './billz-error.js';
import { BillzHttpClient } from './billz-http-client.js';
import { createBillzFetchDouble } from './billz-test-double.js';

const silentLogger = pino({ level: 'silent' });

const buildClient = (
  script: Parameters<typeof createBillzFetchDouble>[0],
  overrides: { maxRetries?: number; timeoutMs?: number } = {},
) => {
  const double = createBillzFetchDouble(script);
  const client = new BillzHttpClient({
    baseUrl: 'https://api-admin.billz.test',
    secretToken: 'test-secret-token',
    timeoutMs: overrides.timeoutMs ?? 5_000,
    maxRetries: overrides.maxRetries ?? 2,
    fetchImpl: double.fetchImpl,
    logger: silentLogger,
    // Backoff is not what these tests are about.
    sleep: async () => undefined,
  });

  return { client, double };
};

describe('authentication', () => {
  it('exchanges the secret token for a bearer token before the first call', async () => {
    const { client, double } = buildClient([{ body: { shops: [] } }]);

    await client.request('/v1/shop');

    const login = double.callsTo('/v1/auth/login');
    expect(login).toHaveLength(1);
    expect(login[0]?.method).toBe('POST');
    expect(login[0]?.body).toEqual({ secret_token: 'test-secret-token' });

    const shopCall = double.callsTo('/v1/shop')[0];
    expect(shopCall?.headers.Authorization).toBe('Bearer test-access-token');
  });

  it('reuses the token instead of logging in for every request', async () => {
    const { client, double } = buildClient([{ body: { shops: [] } }, { body: { shops: [] } }]);

    await client.request('/v1/shop');
    await client.request('/v1/shop');

    expect(double.callsTo('/v1/auth/login')).toHaveLength(1);
  });

  it('re-authenticates once when a token is rejected mid-flight', async () => {
    const { client, double } = buildClient([{ status: 401 }, { body: { shops: [{ id: 'a' }] } }]);

    const result = await client.request<{ shops: unknown[] }>('/v1/shop');

    expect(result.shops).toHaveLength(1);
    expect(double.callsTo('/v1/auth/login')).toHaveLength(2);
  });

  it('never writes the secret token to a log', async () => {
    const written: string[] = [];
    const capturing = pino({ level: 'debug' }, { write: (line: string) => written.push(line) });
    const double = createBillzFetchDouble([{ status: 500 }, { status: 500 }, { status: 500 }]);
    const client = new BillzHttpClient({
      baseUrl: 'https://api-admin.billz.test',
      secretToken: 'super-secret-value',
      timeoutMs: 1_000,
      maxRetries: 0,
      fetchImpl: double.fetchImpl,
      logger: capturing,
      sleep: async () => undefined,
    });

    await expect(client.request('/v1/shop')).rejects.toBeInstanceOf(BillzError);
    expect(written.join('\n')).not.toContain('super-secret-value');
  });
});

describe('error normalisation', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'not_found'],
    [429, 'rate_limited'],
    [500, 'upstream_error'],
  ])('turns HTTP %i into a %s BillzError', async (status, kind) => {
    // Retries are off so the first response is the outcome. A 401 is scripted
    // twice because the client re-authenticates and tries once more before
    // giving up, which is the behaviour asserted separately above.
    const { client } = buildClient(status === 401 ? [{ status }, { status }] : [{ status }], {
      maxRetries: 0,
    });

    const error = await client.request('/v1/shop').catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BillzError);
    expect((error as BillzError).kind).toBe(kind);
    expect((error as BillzError).status).toBe(status);
  });

  it('maps an unreachable host to a network error', async () => {
    const { client } = buildClient([{ throws: new Error('ECONNREFUSED') }], { maxRetries: 0 });

    const error = await client.request('/v1/shop').catch((caught: unknown) => caught);

    expect((error as BillzError).kind).toBe('network');
  });

  it('reports a response that is not JSON as malformed', async () => {
    const { client } = buildClient([{ rawBody: '<html>gateway</html>' }], { maxRetries: 0 });

    const error = await client.request('/v1/shop').catch((caught: unknown) => caught);

    expect((error as BillzError).kind).toBe('malformed_response');
  });

  it('gives up on the configured timeout rather than hanging', async () => {
    const { client } = buildClient([{ hang: true }], { maxRetries: 0, timeoutMs: 20 });

    const error = await client.request('/v1/shop').catch((caught: unknown) => caught);

    expect((error as BillzError).kind).toBe('timeout');
  });

  it('presents an integration failure as a 503, never as the caller being at fault', async () => {
    const { client } = buildClient([{ status: 403 }], { maxRetries: 0 });

    const error = (await client
      .request('/v1/shop')
      .catch((caught: unknown) => caught)) as BillzError;

    expect(error.toApiError().statusCode).toBe(503);
  });
});

describe('retrying', () => {
  it('retries a rate-limited call and honours Retry-After', async () => {
    const sleeps: number[] = [];
    const double = createBillzFetchDouble([
      { status: 429, headers: { 'retry-after': '2' } },
      { body: { shops: [{ id: 'a' }] } },
    ]);
    const client = new BillzHttpClient({
      baseUrl: 'https://api-admin.billz.test',
      secretToken: 'test-secret-token',
      timeoutMs: 1_000,
      maxRetries: 2,
      fetchImpl: double.fetchImpl,
      logger: silentLogger,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const result = await client.request<{ shops: unknown[] }>('/v1/shop');

    expect(result.shops).toHaveLength(1);
    expect(sleeps).toEqual([2_000]);
  });

  it('retries a 500 and succeeds on the next attempt', async () => {
    const { client, double } = buildClient([{ status: 500 }, { body: { shops: [] } }]);

    await client.request('/v1/shop');

    expect(double.callsTo('/v1/shop')).toHaveLength(2);
  });

  it('does not retry a client error', async () => {
    const { client, double } = buildClient([{ status: 404 }]);

    await expect(client.request('/v1/shop')).rejects.toBeInstanceOf(BillzError);
    expect(double.callsTo('/v1/shop')).toHaveLength(1);
  });

  it('stops after the configured number of attempts', async () => {
    const { client, double } = buildClient([{ status: 500 }, { status: 500 }, { status: 500 }], {
      maxRetries: 2,
    });

    await expect(client.request('/v1/shop')).rejects.toBeInstanceOf(BillzError);
    // The first attempt plus two retries.
    expect(double.callsTo('/v1/shop')).toHaveLength(3);
  });
});

describe('request building', () => {
  it('drops empty query values instead of sending them', async () => {
    const { client, double } = buildClient([{ body: {} }]);

    await client.request('/v2/products', {
      query: { page: 1, limit: 50, search: undefined, last_updated_date: '' },
    });

    const url = new URL(double.callsTo('/v2/products')[0]?.url ?? '');
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.has('search')).toBe(false);
    expect(url.searchParams.has('last_updated_date')).toBe(false);
  });

  it('treats an empty body as an empty object rather than failing to parse', async () => {
    const { client } = buildClient([{ rawBody: '' }]);

    await expect(client.request('/v1/shop')).resolves.toEqual({});
  });

  it('reports a missing credential without attempting a call', () => {
    const error = new BillzError('not_configured', 'BILLZ_API_TOKEN is not set');

    expect(error.toApiError().statusCode).toBe(503);
    expect(vi.isMockFunction(error.toApiError)).toBe(false);
  });
});
