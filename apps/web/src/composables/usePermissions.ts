import { hasAtLeastRole, type UserRole } from '@hadiya/shared';
import { computed, type ComputedRef } from 'vue';

import { useAuthStore } from '@/stores/auth';

/**
 * What the signed-in employee may see.
 *
 * This is UX only, and deliberately so: hiding a button stops somebody being
 * offered an action that would fail, but the backend refuses it regardless of
 * what the client rendered. Every rule below has a matching check in a service
 * on the server — this exists so the interface does not lie about what is
 * available, not to keep anybody out.
 */
export interface Permissions {
  role: ComputedRef<UserRole | null>;
  /** True when the account is not tied to one branch. */
  isOrganisationWide: ComputedRef<boolean>;
  can: (minimum: UserRole) => boolean;
  canManageCatalogue: ComputedRef<boolean>;
  canManageStaff: ComputedRef<boolean>;
  canReviewExpenses: ComputedRef<boolean>;
  canSell: ComputedRef<boolean>;
  canViewReports: ComputedRef<boolean>;
}

export const usePermissions = (): Permissions => {
  const auth = useAuthStore();
  const role = computed<UserRole | null>(() => auth.user?.role ?? null);

  const can = (minimum: UserRole): boolean =>
    role.value !== null && hasAtLeastRole(role.value, minimum);

  return {
    role,
    isOrganisationWide: computed(() => can('admin')),
    can,
    // Mirrors `MANAGE_ROLE` in the product and category services.
    canManageCatalogue: computed(() => can('manager')),
    canManageStaff: computed(() => can('admin')),
    canReviewExpenses: computed(() => can('manager')),
    canSell: computed(() => can('cashier')),
    canViewReports: computed(() => can('manager')),
  };
};
