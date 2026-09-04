import { aiRouter } from './ai/index.js';
import { billzRouter } from './billz/index.js';
import { branchRouter } from './branches/index.js';
import { categoryRouter } from './categories/index.js';
import { contentRouter } from './content/index.js';
import { conversationRouter } from './conversations/index.js';
import { customerRouter } from './customers/index.js';
import { expenseRouter } from './expenses/index.js';
import { inventoryRouter } from './inventory/index.js';
import { memoryRouter } from './memory/index.js';
import { notificationRouter } from './notifications/index.js';
import { paymentRouter } from './payments/index.js';
import { productRouter } from './products/index.js';
import { reminderRouter } from './reminders/index.js';
import { saleRouter } from './sales/index.js';
import { userRouter } from './users/index.js';
import type { ApiModule } from './module.types.js';

/**
 * Versioned feature modules, mounted under `<basePath>/v1` in registration
 * order. Adding a module here is the only wiring a new capability needs.
 *
 * Authentication is applied to the whole tree in `routes/index.ts`; a module
 * that needs more than a signed-in user enforces that in its service, where the
 * rule sits next to the logic it protects.
 */
export const apiModules: ApiModule[] = [
  { name: 'branches', basePath: '/branches', router: branchRouter },
  { name: 'employees', basePath: '/users', router: userRouter },
  { name: 'categories', basePath: '/categories', router: categoryRouter },
  { name: 'products', basePath: '/products', router: productRouter },
  { name: 'customers', basePath: '/customers', router: customerRouter },
  { name: 'inventory', basePath: '/inventory', router: inventoryRouter },
  { name: 'sales', basePath: '/sales', router: saleRouter },
  { name: 'payments', basePath: '/payments', router: paymentRouter },
  { name: 'expenses', basePath: '/expenses', router: expenseRouter },
  { name: 'conversations', basePath: '/conversations', router: conversationRouter },
  { name: 'content', basePath: '/content', router: contentRouter },
  { name: 'memory', basePath: '/memory', router: memoryRouter },
  { name: 'reminders', basePath: '/reminders', router: reminderRouter },
  { name: 'notifications', basePath: '/notifications', router: notificationRouter },
  { name: 'assistant', basePath: '/ai', router: aiRouter },
  // Integrations are namespaced so a second one does not collide with a domain.
  { name: 'billz', basePath: '/integrations/billz', router: billzRouter },
];

export type { ApiModule };
