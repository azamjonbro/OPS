/**
 * The single response envelope every Hadiya API endpoint uses.
 *
 * Both the API (when writing) and the web client (when reading) depend on these
 * types, so the wire format cannot drift between them.
 */

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'UNAUTHORIZED',
  'NOT_FOUND',
  'CONFLICT',
  'PAYLOAD_TOO_LARGE',
  'RATE_LIMITED',
  'DEPENDENCY_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export interface ApiResponseMeta {
  /** Correlates a response with its server-side log entries. */
  requestId: string;
  /** ISO-8601 timestamp of when the response was produced. */
  timestamp: string;
}

export interface ApiSuccessResponse<TData> {
  success: true;
  data: TData;
  meta: ApiResponseMeta;
}

export interface ApiErrorBody {
  code: ApiErrorCode;
  message: string;
  /** Machine-readable context, e.g. per-field validation issues. */
  details?: unknown;
}

export interface ApiErrorResponse {
  success: false;
  error: ApiErrorBody;
  meta: ApiResponseMeta;
}

export type ApiResponse<TData> = ApiSuccessResponse<TData> | ApiErrorResponse;

export const isApiSuccessResponse = <TData>(
  response: ApiResponse<TData>,
): response is ApiSuccessResponse<TData> => response.success;
