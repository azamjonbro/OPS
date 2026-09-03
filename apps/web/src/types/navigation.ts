import type { AppModule } from '@hadiya/shared';
import type { RouteLocationRaw } from 'vue-router';

export interface NavigationItem {
  label: string;
  /** The module this entry belongs to; drives permissions later. */
  module: AppModule;
  /** Present once the module has a route; `null` renders a disabled entry. */
  to: RouteLocationRaw | null;
  /** SVG path data for a 24×24 outline icon. */
  icon: string;
}

export interface NavigationSection {
  title: string;
  items: NavigationItem[];
}
