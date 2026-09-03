import { describe, expect, it } from 'vitest';

import { fromMinorUnits, toMinorUnits } from './money.js';

describe('minor unit conversion', () => {
  it('rounds to whole minor units instead of keeping binary float error', () => {
    expect(toMinorUnits(19.99)).toBe(1999);
    expect(toMinorUnits(0.1 + 0.2)).toBe(30);
  });

  it('round-trips a value', () => {
    expect(fromMinorUnits(toMinorUnits(1234.56))).toBe(1234.56);
  });

  it('supports currencies without a fractional part', () => {
    expect(toMinorUnits(12000, 0)).toBe(12000);
  });

  it('refuses non-finite amounts', () => {
    expect(() => toMinorUnits(Number.NaN)).toThrow(TypeError);
  });
});
