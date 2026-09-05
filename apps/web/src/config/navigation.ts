import type { NavigationSection } from '@/types/navigation';

/**
 * Where everything lives, now that the assistant is the product.
 *
 * Hadiya is an AI business assistant. Talking to it is the whole interface, so
 * the chat is not one item in a menu — it *is* the application, and it has a
 * sidebar of its own full of conversations rather than modules.
 *
 * What is *not* here is as deliberate as what is. There are no screens for
 * products, sales, stock, customers or expenses. Billz owns all of that and the
 * assistant reads it live, so a screen here would be a second, staler view of
 * somebody else's data — and a menu of twenty such screens would say the chat
 * is one feature among many.
 *
 * So this is the back office and nothing more: what the assistant produced,
 * what it knows, what it is connected to, and the account it acts as.
 *
 * `minimumRole` mirrors the role each module's service actually requires, so
 * the menu offers only what the person can carry out. It is UX, not security:
 * the backend enforces the same rule and does not care what was rendered.
 */
export const settingsSections: NavigationSection[] = [
  {
    title: 'What the assistant made',
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
    title: 'Connections',
    items: [
      {
        label: 'Integrations',
        module: 'billz',
        to: { name: 'integrations' },
        icon: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        label: 'Employees',
        module: 'employees',
        // Scheduled for a later phase; rendered disabled rather than hidden so
        // the shape of the product stays legible.
        to: null,
        icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0',
        minimumRole: 'admin',
      },
      {
        label: 'Preferences',
        module: 'auth',
        to: { name: 'settings' },
        icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
      },
    ],
  },
];

/**
 * The one entry above the back office: the way back to the conversation.
 *
 * Kept separate from the sections because it is not one of them — it is the
 * thing they are subordinate to.
 */
export const assistantLink: NavigationSection['items'][number] = {
  label: 'Assistant',
  module: 'assistant',
  to: { name: 'assistant' },
  icon: 'M12 3a9 9 0 0 0-9 9v5a3 3 0 0 0 3 3h1v-6H5v-2a7 7 0 1 1 14 0v2h-2v6h1a3 3 0 0 0 3-3v-5a9 9 0 0 0-9-9Z',
};
