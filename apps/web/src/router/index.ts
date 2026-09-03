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
      return { name: 'dashboard' };
    }

    return true;
  });

  router.afterEach((to) => {
    document.title = to.meta.title ? `${to.meta.title} · ${appConfig.appName}` : appConfig.appName;
  });

  return router;
};
