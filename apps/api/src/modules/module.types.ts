import type { Router } from 'express';
import type { AppModule } from '@hadiya/shared';

/**
 * A feature module's public surface. Modules are self-contained
 * (routes -> controller -> service -> repository -> model) and are wired into
 * the API only through this descriptor.
 */
export interface ApiModule {
  /** Must be one of the capabilities declared in `APP_MODULES`. */
  name: AppModule;
  /** Mount path relative to the versioned API root, e.g. `/products`. */
  basePath: string;
  router: Router;
}
