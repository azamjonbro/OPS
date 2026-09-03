import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.js';
import type { PaginationMeta, PaginationParams } from '../types/pagination.js';

export interface ResolvedPagination extends PaginationParams {
  /** Documents to skip — what a repository passes to the driver. */
  skip: number;
  limit: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const toPositiveInteger = (value: number | undefined, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : fallback;

/** Normalises untrusted pagination input into safe, bounded values. */
export const resolvePagination = (params: Partial<PaginationParams> = {}): ResolvedPagination => {
  const page = toPositiveInteger(params.page, DEFAULT_PAGE);
  const pageSize = clamp(toPositiveInteger(params.pageSize, DEFAULT_PAGE_SIZE), 1, MAX_PAGE_SIZE);

  return { page, pageSize, skip: (page - 1) * pageSize, limit: pageSize };
};

export const buildPaginationMeta = (params: PaginationParams, total: number): PaginationMeta => {
  const totalPages = params.pageSize > 0 ? Math.ceil(total / params.pageSize) : 0;

  return {
    page: params.page,
    pageSize: params.pageSize,
    total,
    totalPages,
    hasPrevious: params.page > 1,
    hasNext: params.page < totalPages,
  };
};
