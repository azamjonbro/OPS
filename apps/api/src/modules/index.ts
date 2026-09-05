import { aiRouter } from './ai/index.js';
import { alertRouter } from './alerts/index.js';
import { billzRouter } from './billz/index.js';
import { branchRouter } from './branches/index.js';
import { contentRouter } from './content/index.js';
import { fileRouter } from './files/index.js';
import { conversationRouter } from './conversations/index.js';
import { imageRouter } from './images/index.js';
import { integrationRouter } from './integrations/index.js';
import { memoryRouter } from './memory/index.js';
import { notificationRouter } from './notifications/index.js';
import { reminderRouter } from './reminders/index.js';
import { userRouter } from './users/index.js';
import type { ApiModule } from './module.types.js';

/**
 * Versioned feature modules, mounted under `<basePath>/v1` in registration
 * order. Adding a module here is the only wiring a new capability needs.
 *
 * What is *not* here is as deliberate as what is. Hadiya used to keep its own
 * products, categories, customers, sales, payments, inventory and expenses,
 * mirrored out of Billz by a sync job. All of it is gone.
 *
 * Billz is the system of record for the shop, and a mirror of a system of
 * record is a second version of the truth: it is stale the moment the till
 * rings, and a shopkeeper asking "hozir nechta qoldi?" means *now*. The
 * assistant reads Billz live through that module's capability layer instead, so
 * there is nothing left for a local copy to be for.
 *
 * What remains is what Billz does not do: the conversation, what the assistant
 * remembers, the reminders it sets, the content it writes, the images it draws,
 * and the accounts and branches that say who is asking.
 *
 * Authentication is applied to the whole tree in `routes/index.ts`; a module
 * that needs more than a signed-in user enforces that in its service, where the
 * rule sits next to the logic it protects.
 */
export const apiModules: ApiModule[] = [
  { name: 'branches', basePath: '/branches', router: branchRouter },
  { name: 'employees', basePath: '/users', router: userRouter },
  { name: 'conversations', basePath: '/conversations', router: conversationRouter },
  { name: 'content', basePath: '/content', router: contentRouter },
  { name: 'images', basePath: '/images', router: imageRouter },
  { name: 'files', basePath: '/files', router: fileRouter },
  { name: 'memory', basePath: '/memory', router: memoryRouter },
  { name: 'reminders', basePath: '/reminders', router: reminderRouter },
  { name: 'notifications', basePath: '/notifications', router: notificationRouter },
  { name: 'alerts', basePath: '/alerts', router: alertRouter },
  { name: 'assistant', basePath: '/ai', router: aiRouter },
  // Integrations are namespaced so a second one does not collide with a domain.
  // Billz keeps the specific path it has always had; the hub takes the parent,
  // and is mounted after it so the more specific route is matched first.
  { name: 'billz', basePath: '/integrations/billz', router: billzRouter },
  { name: 'integrations', basePath: '/integrations', router: integrationRouter },
];

export type { ApiModule };
