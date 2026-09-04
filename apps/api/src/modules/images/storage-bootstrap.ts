import { config } from '../../config/index.js';
import { createLogger } from '../../core/logger/logger.js';
import { LocalStorageProvider, setStorageProvider } from './storage/index.js';

const log = createLogger('images');

/**
 * Installs the storage driver the process runs with.
 *
 * Called once at start-up, and again by tests that want their own directory.
 * The driver is chosen here rather than resolved lazily, so a deployment
 * misconfigured for storage fails at boot rather than at the first image
 * somebody paid for.
 */
export const registerImageStorage = (): void => {
  if (config.storage.driver === 'local') {
    setStorageProvider(new LocalStorageProvider(config.storage.localDir));
    log.info({ driver: 'local', directory: config.storage.localDir }, 'image storage ready');

    return;
  }

  // Unreachable while `local` is the only value the schema accepts; it exists
  // so adding a driver to the enum without implementing it fails loudly.
  throw new Error(`Storage driver "${String(config.storage.driver)}" is not implemented`);
};
