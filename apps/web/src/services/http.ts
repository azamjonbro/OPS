import type { ApiErrorResponse, ApiResponse, AuthTokens } from '@hadiya/shared';
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

import { appConfig } from '@/config/env';
import { ApiClientError } from './api-error';
import { tokenStorage } from './token-storage';

const REQUEST_TIMEOUT_MS = 30_000;

export const httpClient: AxiosInstance = axios.create({
  baseURL: appConfig.apiBaseUrl,
  timeout: REQUEST_TIMEOUT_MS,
  headers: { Accept: 'application/json' },
});

httpClient.interceptors.request.use((request) => {
  const tokens = tokenStorage.read();

  if (tokens) {
    request.headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  return request;
});

/**
 * What to do when the access token has expired.
 *
 * Registered by the auth store rather than imported, because the store depends
 * on this module and importing it back would close a cycle. It also keeps the
 * transport ignorant of what "signed out" means to the rest of the application.
 */
type SessionExpiredHandler = () => void;

let onSessionExpired: SessionExpiredHandler | null = null;

export const setSessionExpiredHandler = (handler: SessionExpiredHandler | null): void => {
  onSessionExpired = handler;
};

const isApiErrorResponse = (value: unknown): value is ApiErrorResponse =>
  typeof value === 'object' &&
  value !== null &&
  'success' in value &&
  (value as { success: unknown }).success === false;

/** Turns any transport or API failure into a single error type. */
const toApiClientError = (error: unknown): ApiClientError => {
  if (axios.isCancel(error)) {
    return new ApiClientError('Request cancelled', { code: 'CANCELLED', cause: error });
  }

  if (axios.isAxiosError(error)) {
    const body: unknown = error.response?.data;

    if (isApiErrorResponse(body)) {
      return new ApiClientError(body.error.message, {
        code: body.error.code,
        status: error.response?.status,
        details: body.error.details,
        requestId: body.meta.requestId,
        cause: error,
      });
    }

    return new ApiClientError(
      error.response
        ? `Request failed with status ${error.response.status}`
        : 'Could not reach the server. Check your connection and try again.',
      {
        code: error.response ? 'INTERNAL_ERROR' : 'NETWORK_ERROR',
        ...(error.response ? { status: error.response.status } : {}),
        cause: error,
      },
    );
  }

  return new ApiClientError('Unexpected client error', { code: 'INTERNAL_ERROR', cause: error });
};

/**
 * Refreshes an expired access token, once.
 *
 * The promise is shared: several requests usually fail together when a token
 * expires, and without this each would start its own refresh, and all but one
 * would then retry with a token that had already been rotated away.
 */
let refreshInFlight: Promise<AuthTokens | null> | null = null;

const refreshTokens = async (): Promise<AuthTokens | null> => {
  const current = tokenStorage.read();

  if (!current?.refreshToken) {
    return null;
  }

  try {
    // A bare axios call, not `httpClient`: the interceptor below must not try
    // to refresh the refresh.
    const response = await axios.post<ApiResponse<{ tokens: AuthTokens }>>(
      `${appConfig.apiBaseUrl}/v1/auth/refresh`,
      { refreshToken: current.refreshToken },
      { timeout: REQUEST_TIMEOUT_MS, headers: { Accept: 'application/json' } },
    );

    if (!response.data.success) {
      return null;
    }

    tokenStorage.write(response.data.data.tokens);

    return response.data.data.tokens;
  } catch {
    return null;
  }
};

const HTTP_UNAUTHORIZED = 401;

interface RetriableConfig extends AxiosRequestConfig {
  /** Set once so a request is never retried twice for the same reason. */
  _retried?: boolean;
}

httpClient.interceptors.response.use(
  (response) => response,
  async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== HTTP_UNAUTHORIZED) {
      throw error;
    }

    const request = error.config as RetriableConfig | undefined;

    if (!request || request._retried || request.url?.includes('/auth/refresh')) {
      throw error;
    }

    request._retried = true;

    refreshInFlight ??= refreshTokens().finally(() => {
      refreshInFlight = null;
    });

    const tokens = await refreshInFlight;

    if (!tokens) {
      // The session is genuinely over; the store clears itself and the router
      // guard sends the person to the login screen.
      onSessionExpired?.();

      throw error;
    }

    return httpClient.request({
      ...request,
      headers: { ...request.headers, Authorization: `Bearer ${tokens.accessToken}` },
    });
  },
);

/** Unwraps the API envelope so callers work with the payload directly. */
const request = async <TData>(config: AxiosRequestConfig): Promise<TData> => {
  try {
    const response = await httpClient.request<ApiResponse<TData>>(config);

    if (!response.data.success) {
      throw new ApiClientError(response.data.error.message, {
        code: response.data.error.code,
        status: response.status,
        details: response.data.error.details,
        requestId: response.data.meta.requestId,
      });
    }

    return response.data.data;
  } catch (error) {
    throw error instanceof ApiClientError ? error : toApiClientError(error);
  }
};

export interface RequestOptions extends AxiosRequestConfig {
  /** Cancels the request when the caller loses interest in the answer. */
  signal?: AbortSignal;
}

export const api = {
  get: <TData>(url: string, config?: RequestOptions): Promise<TData> =>
    request<TData>({ ...config, method: 'GET', url }),
  post: <TData>(url: string, data?: unknown, config?: RequestOptions): Promise<TData> =>
    request<TData>({ ...config, method: 'POST', url, data }),
  patch: <TData>(url: string, data?: unknown, config?: RequestOptions): Promise<TData> =>
    request<TData>({ ...config, method: 'PATCH', url, data }),
  delete: <TData>(url: string, config?: RequestOptions): Promise<TData> =>
    request<TData>({ ...config, method: 'DELETE', url }),
};
