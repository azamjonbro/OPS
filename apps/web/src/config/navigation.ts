import type { NavigationSection } from '@/types/navigation';

/**
 * The sidebar.
 *
 * `minimumRole` mirrors the role each module's service actually requires, so
 * the menu offers only what the person can carry out — an entry that always
 * answered "403" would be worse than no entry. It is UX, not security: the
 * backend enforces the same rule and does not care what was rendered.
 *
 * Entries with `to: null` are modules scheduled for a later phase; they render
 * disabled rather than hidden, so the shape of the product stays visible.
 */
export const navigationSections: NavigationSection[] = [
  {
    title: 'Overview',
    items: [
      {
        label: 'Dashboard',
        module: 'reports',
        to: { name: 'dashboard' },
        icon: 'M3 12h6v9H3zM10 3h4v18h-4zM15 8h6v13h-6z',
      },
      {
        label: 'Point of sale',
        module: 'sales',
        to: { name: 'pos' },
        icon: 'M3 3h2l3 12h10l3-8H7M9 21h.01M18 21h.01',
      },
      {
        label: 'Assistant',
        module: 'assistant',
        to: { name: 'assistant' },
        icon: 'M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-6H5v-2a7 7 0 1 1 14 0v2h-2v6h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z',
      },
    ],
  },
  {
    title: 'Operations',
    items: [
      {
        label: 'Sales',
        module: 'sales',
        to: { name: 'sales' },
        icon: 'M4 4h16v4H4zM4 12h16M4 18h10',
      },
      {
        label: 'Products',
        module: 'products',
        to: { name: 'products' },
        icon: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
      },
      {
        label: 'Categories',
        module: 'categories',
        to: { name: 'categories' },
        icon: 'M4 6h6v6H4zM14 6h6v6h-6zM4 16h6v4H4zM14 16h6v4h-6z',
      },
      {
        label: 'Inventory',
        module: 'inventory',
        to: { name: 'inventory' },
        icon: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
      },
      {
        label: 'Customers',
        module: 'customers',
        to: { name: 'customers' },
        icon: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-2a4 4 0 0 0-3-3.9',
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        label: 'Expenses',
        module: 'expenses',
        to: { name: 'expenses' },
        icon: 'M12 3v18M17 8H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6',
      },
      {
        label: 'Reports',
        module: 'reports',
        to: { name: 'reports' },
        icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
        // Reporting reads across the whole business, so it follows the same
        // threshold the sales and expense services use for cross-branch reads.
        minimumRole: 'manager',
      },
    ],
  },
  {
    title: 'Marketing',
    items: [
      {
        label: 'Content',
        module: 'content',
        to: { name: 'content-plans' },
        icon: 'M4 4h16v16H4zM8 8h8M8 12h8M8 16h5',
      },
      {
        label: 'Images',
        module: 'images',
        to: { name: 'images' },
        icon: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
      },
      {
        label: 'Reminders',
        module: 'reminders',
        to: { name: 'reminders' },
        icon: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
      },
      {
        label: 'Notifications',
        module: 'notifications',
        to: { name: 'notifications' },
        icon: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
      },
    ],
  },
  {
    title: 'Administration',
    items: [
      {
        label: 'Employees',
        module: 'employees',
        to: null,
        icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0',
        minimumRole: 'admin',
      },
      {
        label: 'Settings',
        module: 'auth',
        to: { name: 'settings' },
        icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
      },
    ],
  },
];
