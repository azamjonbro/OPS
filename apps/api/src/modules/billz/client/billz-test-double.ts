import type { FetchLike } from './billz-http-client.js';

/**
 * A scripted `fetch` for tests.
 *
 * Automated tests never touch the real Billz API: this records the calls made
 * and replays whatever the test lined up, so authentication, pagination, error
 * handling and retries can all be exercised deterministically.
 */
export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

export interface ScriptedResponse {
  status?: number;
  body?: unknown;
  /** Returned instead of `body` when the payload must not be valid JSON. */
  rawBody?: string;
  headers?: Record<string, string>;
  /** Rejects instead of responding — used for network and timeout cases. */
  throws?: Error;
  /** Never settles until aborted, so the client's own timeout fires. */
  hang?: boolean;
}

export interface BillzFetchDouble {
  fetchImpl: FetchLike;
  calls: RecordedCall[];
  /** Calls to a path, ignoring the query string. */
  callsTo: (path: string) => RecordedCall[];
}

const AUTH_PATH = '/v1/auth/login';

export const createBillzFetchDouble = (
  script: Array<ScriptedResponse | ((call: RecordedCall) => ScriptedResponse)>,
  options: { accessToken?: string } = {},
): BillzFetchDouble => {
  const calls: RecordedCall[] = [];
  let index = 0;

  const fetchImpl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>),
    );
    const call: RecordedCall = {
      url,
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };

    calls.push(call);

    // Authentication is answered automatically so each test only scripts the
    // calls it is actually about.
    if (url.includes(AUTH_PATH)) {
      return jsonResponse(200, {
        data: {
          access_token: options.accessToken ?? 'test-access-token',
          expires_in: 3_600,
        },
      });
    }

    const entry = script[index];
    index += 1;

    if (!entry) {
      throw new Error(`No scripted Billz response for ${call.method} ${url}`);
    }

    const resolved = typeof entry === 'function' ? entry(call) : entry;

    if (resolved.throws) {
      throw resolved.throws;
    }

    if (resolved.hang) {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          const abortError = new Error('The operation was aborted');
          abortError.name = 'AbortError';
          reject(abortError);
        });
      });
    }

    if (resolved.rawBody !== undefined) {
      return new Response(resolved.rawBody, {
        status: resolved.status ?? 200,
        headers: resolved.headers,
      });
    }

    return jsonResponse(resolved.status ?? 200, resolved.body ?? {}, resolved.headers);
  };

  return {
    fetchImpl,
    calls,
    callsTo: (path) => calls.filter((call) => new URL(call.url).pathname === path),
  };
};

const jsonResponse = (status: number, body: unknown, headers?: Record<string, string>): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

/** Builds `count` catalogue rows shaped the way Billz returns them. */
export const billzProductFixtures = (count: number, offset = 0): unknown[] =>
  Array.from({ length: count }, (_unused, index) => ({
    id: `billz-product-${offset + index + 1}`,
    name: `Product ${offset + index + 1}`,
    sku: `SKU-${offset + index + 1}`,
    barcode: `478000000${offset + index + 1}`,
    categories: [{ id: 'billz-category-1', name: 'Drinks' }],
    measurement_unit: { short_name: 'dona' },
    shop_prices: [
      {
        shop_id: 'shop-1',
        shop_name: 'Store Hadiya',
        retail_price: 12_000,
        supply_price: 9_000,
        retail_currency: 'UZS',
      },
    ],
    shop_measurement_values: [
      { shop_id: 'shop-1', shop_name: 'Store Hadiya', active_measurement_value: 5 },
    ],
    updated_at: '2026-09-01T10:00:00Z',
  }));
