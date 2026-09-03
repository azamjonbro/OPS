import { describe, expect, it } from 'vitest';

import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../constants/pagination.js';
import { objectIdSchema, paginationQuerySchema } from './common.js';

describe('paginationQuerySchema', () => {
  it('applies defaults for an empty query string', () => {
    expect(paginationQuerySchema.parse({})).toEqual({
      page: DEFAULT_PAGE,
      pageSize: DEFAULT_PAGE_SIZE,
    });
  });

  it('coerces the numeric strings a query string carries', () => {
    expect(paginationQuerySchema.parse({ page: '4', pageSize: '50' })).toEqual({
      page: 4,
      pageSize: 50,
    });
  });

  it('rejects a page size above the maximum', () => {
    expect(paginationQuerySchema.safeParse({ pageSize: String(MAX_PAGE_SIZE + 1) }).success).toBe(
      false,
    );
  });
});

describe('objectIdSchema', () => {
  it('accepts a 24-character hex id and rejects anything else', () => {
    expect(objectIdSchema.safeParse('507f1f77bcf86cd799439011').success).toBe(true);
    expect(objectIdSchema.safeParse('not-an-id').success).toBe(false);
  });
});
