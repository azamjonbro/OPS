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

  it('keeps a section that still has something in it, and drops the rest', () => {
    signIn('cashier');

    const sections = useNavigation().sections.value;
    const finance = sections.find((section) => section.title === 'Finance');
    const account = sections.find((section) => section.title === 'Account');

    // Finance keeps Expenses and loses Reports.
    expect(finance?.items.map((item) => item.label)).toEqual(['Expenses']);
    // Account keeps Preferences, which everybody may reach, and loses
    // Employees. A heading over an empty list would advertise an area the
    // person cannot get to.
    expect(account?.items.map((item) => item.label)).toEqual(['Preferences']);
    expect(sections.every((section) => section.items.length > 0)).toBe(true);
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

describe('the assistant is the product', () => {
  it('is not one of the back-office sections', () => {
    signIn('manager');

    // The chat has a sidebar of its own, full of conversations. Listing it
    // here as a peer of Products would say it is one screen among twenty.
    expect(labels()).not.toContain('Assistant');
  });
});
