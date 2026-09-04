import { describe, expect, it } from 'vitest';

import { MEMORY_CONFIRMATION_THRESHOLD, MEMORY_STATUSES, MEMORY_TYPES } from './memory.js';

describe('memory vocabulary', () => {
  it('keeps pending as a status of its own, so unconfirmed facts are not used', () => {
    expect(MEMORY_STATUSES).toContain('pending');
    expect(MEMORY_STATUSES).toContain('deleted');
  });

  it('separates preferences from facts and standing instructions', () => {
    expect([...MEMORY_TYPES]).toEqual(['preference', 'fact', 'instruction']);
  });

  it('sets a confirmation threshold below certainty', () => {
    expect(MEMORY_CONFIRMATION_THRESHOLD).toBeGreaterThan(0);
    expect(MEMORY_CONFIRMATION_THRESHOLD).toBeLessThan(1);
  });
});
