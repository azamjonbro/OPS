import { describe, expect, it } from 'vitest';

import { resolveSalePaymentStatus } from './sales.js';

describe('resolveSalePaymentStatus', () => {
  it('is unpaid when nothing has been received', () => {
    expect(resolveSalePaymentStatus(50_000, 0)).toBe('unpaid');
  });

  it('is partial while something is still due', () => {
    expect(resolveSalePaymentStatus(50_000, 20_000)).toBe('partial');
  });

  it('is paid once the total is covered, including overpayment', () => {
    expect(resolveSalePaymentStatus(50_000, 50_000)).toBe('paid');
    expect(resolveSalePaymentStatus(50_000, 60_000)).toBe('paid');
  });
});
