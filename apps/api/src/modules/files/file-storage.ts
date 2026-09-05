import { DOCUMENT_STORAGE_CONTENT_TYPE } from '@hadiya/shared';

import { config } from '../../config/index.js';
import { createLogger } from '../../core/logger/logger.js';
import { LocalStorageProvider } from '../images/storage/local-storage.provider.js';
import type { StorageProvider } from '../images/storage/storage-provider.js';

const log = createLogger('file-storage');

/**
 * Where document bytes live.
 *
 * The *abstraction* is shared with images — same interface, same key rules,
 * same path-traversal defences — but the instance is its own, under its own
 * directory. Documents and generated images have different retention, different
 * content types and different blast radius; giving them one bucket would mean
 * one mistake reaches both.
 *
 * Moving to S3 is implementing `StorageProvider` against a bucket and swapping
 * what is registered here. Nothing above this file knows what a path is.
 */
let provider: StorageProvider | null = null;

export const setFileStorage = (next: StorageProvider | null): void => {
  provider = next;
};

export const getFileStorage = (): StorageProvider => {
  if (!provider) {
    throw new Error('No document storage provider is configured');
  }

  return provider;
};

export const hasFileStorage = (): boolean => provider !== null;

/**
 * Installs the driver at start-up, so a misconfigured deployment fails at boot
 * rather than at the first document somebody uploads.
 */
export const registerFileStorage = (): void => {
  if (config.storage.driver !== 'local') {
    throw new Error(`Storage driver "${String(config.storage.driver)}" is not implemented`);
  }

  const directory = `${config.storage.localDir}/documents`;

  setFileStorage(new LocalStorageProvider(directory, Object.values(DOCUMENT_STORAGE_CONTENT_TYPE)));
  log.info({ driver: 'local', directory }, 'document storage ready');
};
