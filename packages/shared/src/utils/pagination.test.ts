import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.js';
import { buildPaginationMeta, resolvePagination } from './pagination.js';

describe('resolvePagination', () => {
  it('falls back to the defaults when nothing is provided', () => {
    expect(resolvePagination()).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('computes skip from the page and page size', () => {
    expect(resolvePagination({ page: 3, pageSize: 25 })).toEqual({
      page: 3,
      pageSize: 25,
      skip: 50,
      limit: 25,
    });
  });

  it('caps the page size so a client cannot request an unbounded read', () => {
    expect(resolvePagination({ pageSize: MAX_PAGE_SIZE + 500 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it('rejects zero, negative and fractional input', () => {
    expect(resolvePagination({ page: 0, pageSize: -10 })).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
      skip: 0,
      limit: DEFAULT_PAGE_SIZE,
    });
    expect(resolvePagination({ page: 2.9 }).page).toBe(2);
  });
});

describe('buildPaginationMeta', () => {
  it('describes a middle page', () => {
    expect(buildPaginationMeta({ page: 2, pageSize: 10 }, 35)).toEqual({
      page: 2,
      pageSize: 10,
      total: 35,
      totalPages: 4,
      hasPrevious: true,
      hasNext: true,
    });
  });

  it('has neither neighbour when the result set is empty', () => {
    expect(buildPaginationMeta({ page: 1, pageSize: 10 }, 0)).toMatchObject({
      totalPages: 0,
      hasPrevious: false,
      hasNext: false,
    });
  });
});
