import { hasAtLeastRole, type UserRole } from '@hadiya/shared';
import { createRouter, createWebHistory, type Router } from 'vue-router';

import { appConfig } from '@/config/env';
import { useAuthStore } from '@/stores/auth';
import { routes } from './routes';

declare module 'vue-router' {
  interface RouteMeta {
    /** Shown in the top bar and the document title. */
    title?: string;
    requiresAuth?: boolean;
    /** Redirects an already authenticated user away, e.g. from the login page. */
    guestOnly?: boolean;
    /**
     * Lowest role that may open the route.
     *
     * A second line of UX defence beside the hidden menu entry: somebody who
     * types the URL, or follows a stale bookmark, lands on the assistant rather
     * than on a page of permission errors. The API is what actually refuses.
     *
     * No route declares one today — the screens that needed a role were the
     * ones mirroring Billz, and they are gone. The rule stays because the next
     * one that needs it (staff administration) is already in the menu.
     */
    minimumRole?: UserRole;
    /** Ancestors for the breadcrumb trail; the page's own title is appended. */
    breadcrumb?: Array<{ label: string; to?: { name: string } }>;
  }
}

export const createAppRouter = (): Router => {
  const router = createRouter({
    history: createWebHistory(import.meta.env.BASE_URL),
    routes,
    scrollBehavior: (_to, _from, savedPosition) => savedPosition ?? { top: 0 },
  });

  router.beforeEach(async (to) => {
    const auth = useAuthStore();

    // Enforcement waits for the auth module; the guard itself is complete.
    if (!appConfig.features.authEnforced) {
      return true;
    }

    await auth.restore();

    if (to.meta.requiresAuth && !auth.isAuthenticated) {
      return { name: 'login', query: { redirect: to.fullPath } };
    }

    if (to.meta.guestOnly && auth.isAuthenticated) {
      return { name: 'assistant' };
    }

    if (to.meta.minimumRole && auth.user && !hasAtLeastRole(auth.user.role, to.meta.minimumRole)) {
      return { name: 'assistant' };
    }

    return true;
  });

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ${appConfig.appName}` : appConfig.appName;
  });

  return router;
};
