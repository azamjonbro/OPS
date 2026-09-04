import type { AppModule, UserRole } from '@hadiya/shared';
import type { RouteLocationRaw } from 'vue-router';

export interface NavigationItem {
  label: string;
  /** The module this entry belongs to. */
  module: AppModule;
  /** Present once the module has a route; `null` renders a disabled entry. */
  to: RouteLocationRaw | null;
  /** SVG path data for a 24×24 outline icon. */
  icon: string;
  /**
   * Lowest role that may reach it. Absent means any signed-in employee.
   *
   * This hides what a person cannot use; it does not protect anything. The
   * matching rule is enforced in a service on the server, which is what decides.
   */
  minimumRole?: UserRole;
}

export interface NavigationSection {
  title: string;
  items: NavigationItem[];
}
