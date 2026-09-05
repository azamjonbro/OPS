import { computed, type ComputedRef } from 'vue';

import { settingsSections } from '@/config/navigation';
import { usePermissions } from '@/composables/usePermissions';
import type { NavigationSection } from '@/types/navigation';

/**
 * The back office as this employee sees it.
 *
 * Sections with nothing left in them disappear entirely: a heading over an
 * empty list tells a cashier there is a "Finance" area they cannot reach, which
 * is worse than not mentioning it.
 */
export const useNavigation = (): { sections: ComputedRef<NavigationSection[]> } => {
  const { can } = usePermissions();

  const sections = computed(() =>
    settingsSections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) => !item.minimumRole || can(item.minimumRole)),
      }))
      .filter((section) => section.items.length > 0),
  );

  return { sections };
};
