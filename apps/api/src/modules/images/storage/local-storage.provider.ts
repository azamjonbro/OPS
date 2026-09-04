import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { IMAGE_CONTENT_TYPES, type ImageContentType } from '@hadiya/shared';

import { createLogger } from '../../../core/logger/logger.js';
import {
  assertSafeStorageKey,
  StorageError,
  type RetrievedObject,
  type StorageProvider,
  type StoredObject,
} from './storage-provider.js';

const log = createLogger('storage-local');

/**
 * Files on disk, for development and single-node deployments.
 *
 * Two defences, because a key is a path here and a path is where this goes
 * wrong. The key is validated against the shared pattern *and* the resolved
 * absolute path is checked to still be inside the root — the second catches
 * anything the first missed, including symlink and encoding tricks, and neither
 * is trusted alone.
 *
 * The content type is stored beside the file rather than guessed from the
 * extension on the way out, so a file cannot be served as a type it is not.
 * Moving to S3 means implementing the same four methods against a bucket; the
 * service above does not change, and neither does the key.
 */
export class LocalStorageProvider implements StorageProvider {
  readonly name = 'local';

  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  /**
   * Resolves a key inside the root, or refuses.
   *
   * `path.resolve` collapses `..` before the check, so a key that climbs out is
   * caught by comparing the result to the root — not by inspecting the input,
   * which is what a blocklist would do and would eventually miss something.
   */
  private resolve(key: string): string {
    assertSafeStorageKey(key);

    const absolute = path.resolve(this.root, key);
    const rootWithSeparator = this.root.endsWith(path.sep) ? this.root : `${this.root}${path.sep}`;

    if (!absolute.startsWith(rootWithSeparator)) {
      throw new StorageError(`"${key}" resolves outside the storage root`);
    }

    return absolute;
  }

  /** The sidecar that remembers what a file actually is. */
  private metaPath(absolute: string): string {
    return `${absolute}.meta.json`;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    if (!(IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)) {
      throw new StorageError(`"${contentType}" is not a content type this store accepts`);
    }

    const absolute = this.resolve(key);

    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, data);
    await writeFile(
      this.metaPath(absolute),
      JSON.stringify({
        contentType,
        sizeBytes: data.byteLength,
        // Lets a later integrity check notice a file that changed underneath us.
        sha256: createHash('sha256').update(data).digest('hex'),
        storedAt: new Date().toISOString(),
      }),
    );

    log.debug({ key, sizeBytes: data.byteLength }, 'object stored');

    return { key, contentType, sizeBytes: data.byteLength };
  }

  async read(key: string): Promise<RetrievedObject> {
    const absolute = this.resolve(key);

    let data: Buffer;

    try {
      data = await readFile(absolute);
    } catch {
      // The underlying errno is deliberately not carried through: the caller
      // can do nothing with it, and it names an absolute path on the server.
      throw new StorageError(`"${key}" is not in storage`);
    }

    return {
      data,
      contentType: await this.readContentType(absolute),
      sizeBytes: data.byteLength,
    };
  }

  private async readContentType(absolute: string): Promise<ImageContentType> {
    try {
      const raw: unknown = JSON.parse(await readFile(this.metaPath(absolute), 'utf8'));
      const contentType = (raw as { contentType?: unknown }).contentType;

      if (
        typeof contentType === 'string' &&
        (IMAGE_CONTENT_TYPES as readonly string[]).includes(contentType)
      ) {
        return contentType as ImageContentType;
      }
    } catch {
      // A missing or unreadable sidecar must not make the file unreadable.
    }

    // Never guessed from the extension: PNG is the format everything here is
    // written as, and a wrong guess would serve a file as something it is not.
    return 'image/png';
  }

  async delete(key: string): Promise<boolean> {
    const absolute = this.resolve(key);

    if (!(await this.exists(key))) {
      return false;
    }

    await rm(absolute, { force: true });
    await rm(this.metaPath(absolute), { force: true });

    return true;
  }

  async exists(key: string): Promise<boolean> {
    try {
      const info = await stat(this.resolve(key));

      return info.isFile();
    } catch {
      return false;
    }
  }
}
