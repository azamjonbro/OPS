import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';

import { useNavigation } from '@/composables/useNavigation';
import { usePermissions } from '@/composables/usePermissions';
import { useAuthStore } from '@/stores/auth';
import { makeUser } from '@/test/factories';

/**
 * The menu offers only what the person can actually carry out. Hiding is UX,
 * not a control — but an entry that always answered "403" would be worse than
 * no entry at all.
 */
beforeEach(() => setActivePinia(createPinia()));

const signIn = (role: 'cashier' | 'manager' | 'admin') => {
  const auth = useAuthStore();
  auth.user = makeUser({ role });
};

const labels = (): string[] =>
  useNavigation()
    .sections.value.flatMap((section) => section.items)
    .map((item) => item.label);

describe('permission-based navigation', () => {
  it('hides reports from a cashier and shows the till', () => {
    signIn('cashier');

    expect(labels()).toContain('Point of sale');
    expect(labels()).not.toContain('Reports');
    expect(labels()).not.toContain('Employees');
  });

  it('shows reports to a manager', () => {
    signIn('manager');

    expect(labels()).toContain('Reports');
    expect(labels()).not.toContain('Employees');
  });

  it('shows administration to an admin', () => {
    signIn('admin');

    expect(labels()).toContain('Employees');
  });

  it('drops a section once nothing in it is permitted', () => {
    signIn('cashier');

    // Finance holds Expenses and Reports; a cashier keeps Expenses, so the
    // section survives — the empty-section rule is exercised by the titles.
    const titles = useNavigation().sections.value.map((section) => section.title);
    expect(titles).not.toContain('Administration');
  });

  it('derives capability flags from the role', () => {
    signIn('cashier');
    const cashier = usePermissions();

    expect(cashier.canSell.value).toBe(true);
    expect(cashier.canManageCatalogue.value).toBe(false);
    expect(cashier.canReviewExpenses.value).toBe(false);

    signIn('manager');
    const manager = usePermissions();

    expect(manager.canManageCatalogue.value).toBe(true);
    expect(manager.canManageStaff.value).toBe(false);
  });
});
