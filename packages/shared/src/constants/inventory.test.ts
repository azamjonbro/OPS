import { describe, expect, it } from 'vitest';

import { toSignedQuantity } from './inventory.js';

describe('toSignedQuantity', () => {
  it('adds stock for inbound movement types', () => {
    expect(toSignedQuantity('purchase', 5)).toBe(5);
    expect(toSignedQuantity('return', 2)).toBe(2);
    expect(toSignedQuantity('transfer_in', 3)).toBe(3);
  });

  it('removes stock for outbound types, whatever sign the caller passes', () => {
    expect(toSignedQuantity('sale', 4)).toBe(-4);
    expect(toSignedQuantity('sale', -4)).toBe(-4);
    expect(toSignedQuantity('transfer_out', 1)).toBe(-1);
  });

  it('keeps the caller sign for adjustments, which correct in both directions', () => {
    expect(toSignedQuantity('adjustment', 7)).toBe(7);
    expect(toSignedQuantity('adjustment', -7)).toBe(-7);
  });
});
