import type { RouteRecordRaw } from 'vue-router';

import AppLayout from '@/layouts/AppLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';

/**
 * Route metadata is typed in `router/index.ts`. Feature modules add their pages
 * as children of the application layout.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppLayout,
    children: [
      {
        path: '',
        name: 'dashboard',
        component: () => import('@/pages/DashboardPage.vue'),
        meta: { title: 'Dashboard', requiresAuth: true },
      },
    ],
  },
  {
    path: '/auth',
    component: AuthLayout,
    children: [
      {
        path: 'login',
        name: 'login',
        component: () => import('@/pages/LoginPage.vue'),
        meta: { title: 'Sign in', guestOnly: true },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/pages/NotFoundPage.vue'),
    meta: { title: 'Page not found' },
  },
];
