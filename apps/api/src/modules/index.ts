import type { ApiModule } from './module.types.js';

/**
 * Versioned feature modules, mounted under `<basePath>/v1`.
 *
 * This phase ships the foundation only: authentication, products, sales and
 * the rest of `APP_MODULES` are added here as they are implemented, with no
 * other file needing to change.
 */
export const apiModules: ApiModule[] = [];

export type { ApiModule };
