import type { NavigationSection } from '@/types/navigation';

/**
 * The sidebar. Entries with `to: null` are the modules scheduled for later
 * phases: they are rendered disabled rather than hidden, so the intended shape
 * of the product stays visible.
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
        label: 'Reminders',
        module: 'reminders',
        to: { name: 'reminders' },
        icon: 'M12 8v4l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
      },
      {
        label: 'Assistant',
        module: 'assistant',
        to: null,
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
        to: null,
        icon: 'M3 3h2l3 12h10l3-8H7M9 21h.01M18 21h.01',
      },
      {
        label: 'Products',
        module: 'products',
        to: null,
        icon: 'M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8',
      },
      {
        label: 'Inventory',
        module: 'inventory',
        to: null,
        icon: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
      },
      {
        label: 'Customers',
        module: 'customers',
        to: null,
        icon: 'M16 20v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2M9.5 9.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM21 20v-2a4 4 0 0 0-3-3.9',
      },
    ],
  },
  {
    title: 'Finance',
    items: [
      {
        label: 'Payments',
        module: 'payments',
        to: null,
        icon: 'M3 7h18v10H3zM3 11h18M7 15h3',
      },
      {
        label: 'Expenses',
        module: 'expenses',
        to: null,
        icon: 'M12 3v18M17 8H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H6',
      },
      {
        label: 'Reports',
        module: 'reports',
        to: null,
        icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
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
      },
      {
        label: 'Branches',
        module: 'branches',
        to: null,
        icon: 'M3 21h18M5 21V7l7-4 7 4v14M9 21v-6h6v6',
      },
      {
        label: 'Audit log',
        module: 'audit',
        to: null,
        icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8ZM14 2v6h6M9 13h6M9 17h4',
      },
    ],
  },
];
