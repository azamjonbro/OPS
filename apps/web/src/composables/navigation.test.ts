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
  it('offers what the assistant produced, to anybody signed in', () => {
    signIn('cashier');

    expect(labels()).toEqual(
      expect.arrayContaining(['Content', 'Images', 'Reminders', 'Notifications']),
    );
  });

  it('hides staff administration from anybody below an admin', () => {
    signIn('manager');

    expect(labels()).not.toContain('Employees');

    signIn('admin');

    expect(labels()).toContain('Employees');
  });

  it('drops a section that has nothing left in it', () => {
    signIn('cashier');

    const sections = useNavigation().sections.value;
    const account = sections.find((section) => section.title === 'Account');

    // Account keeps Preferences, which everybody may reach, and loses
    // Employees. A heading over an empty list would advertise an area the
    // person cannot get to.
    expect(account?.items.map((item) => item.label)).toEqual(['Preferences']);
    expect(sections.every((section) => section.items.length > 0)).toBe(true);
  });

  it('offers no screen that mirrors Billz', () => {
    signIn('admin');

    // Billz owns the shop and the assistant reads it live. A screen here would
    // be a second, staler view of somebody else's data.
    for (const gone of [
      'Products',
      'Sales',
      'Point of sale',
      'Inventory',
      'Customers',
      'Expenses',
    ]) {
      expect(labels()).not.toContain(gone);
    }
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
