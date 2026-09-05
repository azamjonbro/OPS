import type { RouteRecordRaw } from 'vue-router';

import AppLayout from '@/layouts/AppLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';

/**
 * Every page is loaded lazily, and there are deliberately few of them.
 *
 * Hadiya is an AI business assistant. Billz is the system of record for the
 * shop — the catalogue, the till, the stock, the customer ledger — and the
 * assistant reads it live, so there are no screens here that mirror it. What
 * remains is the conversation and the things the assistant itself produces:
 * content, images, reminders, notifications.
 *
 * `breadcrumb` names the ancestors a detail page hangs off, so the trail can
 * say "Settings › Content › Plan" without parsing the URL.
 */
export const routes: RouteRecordRaw[] = [
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
    path: '/',
    component: AppLayout,
    children: [
      {
        // Signing in lands on the assistant, not on a menu of screens: the
        // first thing Hadiya should offer is a question box.
        path: '',
        redirect: { name: 'assistant' },
      },
      {
        path: 'content',
        name: 'content-plans',
        component: () => import('@/pages/ContentPlansPage.vue'),
        meta: {
          title: 'Content plans',
          requiresAuth: true,
          breadcrumb: [{ label: 'Settings', to: { name: 'settings' } }],
        },
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
        meta: {
          title: 'Images',
          requiresAuth: true,
          breadcrumb: [{ label: 'Settings', to: { name: 'settings' } }],
        },
      },
      {
        path: 'reminders',
        name: 'reminders',
        component: () => import('@/pages/RemindersPage.vue'),
        meta: {
          title: 'Reminders',
          requiresAuth: true,
          breadcrumb: [{ label: 'Settings', to: { name: 'settings' } }],
        },
      },
      {
        path: 'notifications',
        name: 'notifications',
        component: () => import('@/pages/NotificationsPage.vue'),
        meta: {
          title: 'Notifications',
          requiresAuth: true,
          breadcrumb: [{ label: 'Settings', to: { name: 'settings' } }],
        },
      },
      /**
       * The Integration Hub: what this account has connected, and what the
       * assistant may do there.
       *
       * At the top level rather than under `settings`, because connecting a CRM
       * is not a preference — it changes what Hadiya can do — and because the
       * detail page is where MCP tool permissions are set, which is the most
       * consequential screen in the application.
       */
      {
        path: 'integrations',
        name: 'integration-hub',
        component: () => import('@/pages/IntegrationHubPage.vue'),
        meta: { title: 'Integrations', requiresAuth: true },
      },
      {
        path: 'integrations/:id',
        name: 'integration',
        component: () => import('@/pages/IntegrationDetailPage.vue'),
        meta: {
          title: 'Integration',
          requiresAuth: true,
          breadcrumb: [{ label: 'Integrations', to: { name: 'integration-hub' } }],
        },
      },
      /**
       * The older screen, which is about something else despite the name it
       * had: the health of the model and image providers configured in the
       * deployment's environment, and what they have cost. Kept, and renamed to
       * what it is, so the hub above can own the word "integrations".
       */
      {
        path: 'settings/providers',
        name: 'provider-usage',
        component: () => import('@/pages/IntegrationsPage.vue'),
        meta: {
          title: 'Providers & usage',
          requiresAuth: true,
          breadcrumb: [{ label: 'Settings', to: { name: 'settings' } }],
        },
      },
      {
        path: 'settings',
        name: 'settings',
        component: () => import('@/pages/SettingsPage.vue'),
        meta: { title: 'Settings', requiresAuth: true },
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
