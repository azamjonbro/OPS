/**
 * Where bytes live, behind one interface.
 *
 * The image service never touches a filesystem or an SDK: it asks storage to
 * keep an object under a key and to give it back later. That is the whole seam,
 * and it is deliberately small — `put`, `read`, `delete`, `exists` — because
 * anything richer would be shaped by the local implementation and would not
 * survive the move to object storage.
 *
 * A key is an opaque identifier the *server* chooses, never something a client
 * supplies. That is a security property, not a convenience: a key that a
 * request could influence is a path traversal waiting to happen, so
 * `assertSafeKey` is enforced by every implementation rather than trusted to
 * callers.
 */

export interface StoredObject {
  key: string;
  contentType: string;
  sizeBytes: number;
}

export interface RetrievedObject {
  data: Buffer;
  contentType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly name: string;
  put: (key: string, data: Buffer, contentType: string) => Promise<StoredObject>;
  read: (key: string) => Promise<RetrievedObject>;
  delete: (key: string) => Promise<boolean>;
  exists: (key: string) => Promise<boolean>;
}

/**
 * The only key shape any provider accepts.
 *
 * Lowercase segments of letters, digits, dashes and underscores, separated by
 * single slashes, ending in a short extension. No dots as a segment, so `..`
 * cannot appear; no leading slash, so a key cannot escape a prefix; no
 * backslashes, so a Windows path cannot slip through a POSIX check.
 */
const SAFE_KEY = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*\.[a-z0-9]{1,5}$/;

export const MAX_KEY_LENGTH = 200;

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export const isSafeStorageKey = (key: string): boolean =>
  key.length > 0 && key.length <= MAX_KEY_LENGTH && SAFE_KEY.test(key);

/**
 * Refuses anything that is not a key this system generated.
 *
 * Called at the top of every storage operation. Belt and braces: the keys are
 * built server-side from object ids, so nothing should ever fail here — which
 * is exactly why it must throw loudly if something does.
 */
export const assertSafeStorageKey = (key: string): void => {
  if (!isSafeStorageKey(key)) {
    throw new StorageError(`"${key}" is not a valid storage key`);
  }
};

let active: StorageProvider | null = null;

export const setStorageProvider = (provider: StorageProvider | null): void => {
  active = provider;
};

export const getStorageProvider = (): StorageProvider => {
  if (!active) {
    throw new StorageError('No storage provider is configured');
  }

  return active;
};

export const hasStorageProvider = (): boolean => active !== null;
