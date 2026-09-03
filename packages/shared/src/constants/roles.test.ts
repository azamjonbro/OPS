import { describe, expect, it } from 'vitest';

import { hasAtLeastRole, isUserRole } from './roles.js';

describe('role privilege ordering', () => {
  it('grants access to a more privileged role', () => {
    expect(hasAtLeastRole('owner', 'manager')).toBe(true);
    expect(hasAtLeastRole('manager', 'manager')).toBe(true);
  });

  it('denies access to a less privileged role', () => {
    expect(hasAtLeastRole('cashier', 'manager')).toBe(false);
  });

  it('narrows unknown values', () => {
    expect(isUserRole('admin')).toBe(true);
    expect(isUserRole('superuser')).toBe(false);
  });
});
