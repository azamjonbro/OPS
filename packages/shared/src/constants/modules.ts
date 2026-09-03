/**
 * Every business capability Hadiya 2.0 will ship. The list is the vocabulary
 * used by permissions, audit logs and the AI tool registry, so those features
 * cannot invent module names of their own.
 *
 * Only the modules that are actually implemented get an API surface; being
 * listed here does not imply the module exists yet.
 */
export const APP_MODULES = [
  'auth',
  'users',
  'employees',
  'branches',
  'products',
  'inventory',
  'sales',
  'customers',
  'payments',
  'expenses',
  'reports',
  'billz',
  'assistant',
  'conversations',
  'memory',
  'reminders',
  'content',
  'images',
  'notifications',
  'audit',
] as const;

export type AppModule = (typeof APP_MODULES)[number];

/** CRUD-ish verbs a permission can grant on a module. */
export const MODULE_ACTIONS = ['read', 'create', 'update', 'delete', 'export'] as const;

export type ModuleAction = (typeof MODULE_ACTIONS)[number];

export type Permission = `${AppModule}:${ModuleAction}`;

export const buildPermission = (module: AppModule, action: ModuleAction): Permission =>
  `${module}:${action}`;
