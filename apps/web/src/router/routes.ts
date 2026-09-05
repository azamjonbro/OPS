import type { RouteRecordRaw } from 'vue-router';

import AppLayout from '@/layouts/AppLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';

/**
 * Every page is loaded lazily.
 *
 * A till that opens quickly matters more than one that has everything in
 * memory: the POS and the dashboard are what a cashier reaches for, and they
 * should not wait for the reports page to download. `breadcrumb` names the
 * ancestors a detail page hangs off, so the trail can say "Sales › Receipt"
 * without parsing the URL.
 */
export const routes: RouteRecordRaw[] = [
  {
    path: '/',
    component: AppLayout,
    children: [
      {
        // Signing in lands on the assistant, not on a dashboard of figures:
        // the first thing Hadiya should offer is a question box. The dashboard
        // is still here, one level in, for somebody who wants the numbers raw.
        path: '',
        redirect: { name: 'assistant' },
      },
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/pages/DashboardPage.vue'),
        meta: { title: 'Dashboard', requiresAuth: true },
      },
      {
        path: 'pos',
        name: 'pos',
        component: () => import('@/pages/PosPage.vue'),
        meta: { title: 'Point of sale', requiresAuth: true },
      },
      {
        path: 'sales',
        name: 'sales',
        component: () => import('@/pages/SalesPage.vue'),
        meta: { title: 'Sales', requiresAuth: true },
      },
      {
        path: 'sales/:id',
        name: 'sale-detail',
        component: () => import('@/pages/SaleDetailPage.vue'),
        meta: {
          title: 'Receipt',
          requiresAuth: true,
          breadcrumb: [
            { label: 'Settings', to: { name: 'settings' } },
            { label: 'Sales', to: { name: 'sales' } },
          ],
        },
      },
      {
        path: 'products',
        name: 'products',
        component: () => import('@/pages/ProductsPage.vue'),
        meta: { title: 'Products', requiresAuth: true },
      },
      {
        path: 'categories',
        name: 'categories',
        component: () => import('@/pages/CategoriesPage.vue'),
        meta: { title: 'Categories', requiresAuth: true },
      },
      {
        path: 'inventory',
        name: 'inventory',
        component: () => import('@/pages/InventoryPage.vue'),
        meta: { title: 'Inventory', requiresAuth: true },
      },
      {
        path: 'customers',
        name: 'customers',
        component: () => import('@/pages/CustomersPage.vue'),
        meta: { title: 'Customers', requiresAuth: true },
      },
      {
        path: 'customers/:id',
        name: 'customer-detail',
        component: () => import('@/pages/CustomerDetailPage.vue'),
        meta: {
          title: 'Customer',
          requiresAuth: true,
          breadcrumb: [
            { label: 'Settings', to: { name: 'settings' } },
            { label: 'Customers', to: { name: 'customers' } },
          ],
        },
      },
      {
        path: 'expenses',
        name: 'expenses',
        component: () => import('@/pages/ExpensesPage.vue'),
        meta: { title: 'Expenses', requiresAuth: true },
      },
      {
        path: 'reports',
        name: 'reports',
        component: () => import('@/pages/ReportsPage.vue'),
        // Mirrors the sidebar, so a typed URL behaves the same as a hidden link.
        meta: { title: 'Reports', requiresAuth: true, minimumRole: 'manager' },
      },
      {
        path: 'content',
        name: 'content-plans',
        component: () => import('@/pages/ContentPlansPage.vue'),
        meta: { title: 'Content plans', requiresAuth: true },
      },
      {
        path: 'content/:id',
        name: 'content-plan',
        component: () => import('@/pages/ContentPlanDetailPage.vue'),
        meta: {
          title: 'Content plan',
          requiresAuth: true,
          breadcrumb: [
            { label: 'Settings', to: { name: 'settings' } },
            { label: 'Content', to: { name: 'content-plans' } },
          ],
        },
      },
      {
        path: 'images',
        name: 'images',
        component: () => import('@/pages/ImagesPage.vue'),
        meta: { title: 'Images', requiresAuth: true },
      },
      {
        path: 'reminders',
        name: 'reminders',
        component: () => import('@/pages/RemindersPage.vue'),
        meta: { title: 'Reminders', requiresAuth: true },
      },
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
        meta: { title: 'Notifications', requiresAuth: true },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/pages/SettingsPage.vue'),
        meta: { title: 'Settings', requiresAuth: true },
      },
    ],
  },
  /**
   * The assistant sits outside `AppLayout`.
   *
   * Not an oversight: a conversation needs the whole viewport, with only the
   * transcript scrolling and the composer pinned to the bottom. `AppLayout`'s
   * main area scrolls the page instead, and nesting the two gives the double
   * scrollbar every chat-in-a-dashboard has. `ChatLayout` provides its own
   * sidebar and top bar, so nothing from the shell is lost.
   *
   * Both routes render the same page: `/assistant` is a thread that has not
   * been created yet, and the id appears once the first turn has been sent.
   */
  {
    path: '/assistant',
    name: 'assistant',
    component: () => import('@/pages/AssistantPage.vue'),
    meta: { title: 'Assistant', requiresAuth: true },
  },
  {
    path: '/assistant/:id',
    name: 'assistant-conversation',
    component: () => import('@/pages/AssistantPage.vue'),
    meta: { title: 'Assistant', requiresAuth: true },
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
