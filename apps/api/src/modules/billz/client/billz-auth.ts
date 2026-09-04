import type { Logger } from 'pino';

import { BillzError } from './billz-error.js';
import { BILLZ_ENDPOINTS } from './billz-endpoints.js';
import type { BillzAuthResponse } from './billz-raw.types.js';

/** Refresh this many seconds before the token actually expires. */
const EXPIRY_MARGIN_SECONDS = 60;
/** Used when Billz returns a token without an `expires_in`. */
const FALLBACK_LIFETIME_SECONDS = 3_600;

export interface BillzTokenRequest {
  (path: string, body: unknown): Promise<unknown>;
}

/**
 * Holds the bearer token for the integration.
 *
 * Billz issues a token in exchange for the account's secret token. The secret
 * never leaves this class and is never logged; only the derived bearer is
 * handed out, and only to the HTTP client.
 *
 * Concurrent callers share one in-flight login rather than each starting their
 * own — a sync fanning out twenty requests must not trigger twenty logins.
 */
export class BillzTokenProvider {
  private token: string | null = null;
  private expiresAtMs = 0;
  private inFlight: Promise<string> | null = null;

  constructor(
    private readonly secretToken: string,
    private readonly request: BillzTokenRequest,
    private readonly log: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** Drops the cached token so the next call authenticates again. */
  invalidate(): void {
    this.token = null;
    this.expiresAtMs = 0;
  }

  async getToken(): Promise<string> {
    if (this.token && this.expiresAtMs > this.now()) {
      return this.token;
    }

    this.inFlight ??= this.login().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  private async login(): Promise<string> {
    const response = (await this.request(BILLZ_ENDPOINTS.login, {
      secret_token: this.secretToken,
    })) as BillzAuthResponse;

    const accessToken = response?.data?.access_token;

    if (typeof accessToken !== 'string' || accessToken.length === 0) {
      throw new BillzError('unauthorized', 'Billz did not return an access token', {
        endpoint: BILLZ_ENDPOINTS.login,
      });
    }

    const lifetime = response.data?.expires_in ?? FALLBACK_LIFETIME_SECONDS;

    this.token = accessToken;
    this.expiresAtMs = this.now() + Math.max(lifetime - EXPIRY_MARGIN_SECONDS, 1) * 1_000;

    this.log.debug({ expiresInSeconds: lifetime }, 'billz access token issued');

    return accessToken;
  }
}
