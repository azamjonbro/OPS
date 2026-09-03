import type { ApiErrorResponse, ApiResponse } from '@hadiya/shared';
import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios';

import { appConfig } from '@/config/env';
import { ApiClientError } from './api-error';
import { tokenStorage } from './token-storage';

const REQUEST_TIMEOUT_MS = 20_000;

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

const isApiErrorResponse = (value: unknown): value is ApiErrorResponse =>
  typeof value === 'object' &&
  value !== null &&
  'success' in value &&
  (value as { success: unknown }).success === false;

/** Turns any transport or API failure into a single error type. */
const toApiClientError = (error: unknown): ApiClientError => {
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
      error.response ? `Request failed with status ${error.response.status}` : 'Network error',
      {
        code: error.response ? 'INTERNAL_ERROR' : 'NETWORK_ERROR',
        ...(error.response ? { status: error.response.status } : {}),
        cause: error,
      },
    );
  }

  return new ApiClientError('Unexpected client error', { code: 'INTERNAL_ERROR', cause: error });
};

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
    throw toApiClientError(error);
  }
};

export const api = {
  get: <TData>(url: string, config?: AxiosRequestConfig): Promise<TData> =>
    request<TData>({ ...config, method: 'GET', url }),
  post: <TData>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<TData> =>
    request<TData>({ ...config, method: 'POST', url, data }),
  patch: <TData>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<TData> =>
    request<TData>({ ...config, method: 'PATCH', url, data }),
  delete: <TData>(url: string, config?: AxiosRequestConfig): Promise<TData> =>
    request<TData>({ ...config, method: 'DELETE', url }),
};
