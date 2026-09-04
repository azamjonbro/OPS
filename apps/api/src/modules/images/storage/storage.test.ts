import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PNG_PIXEL } from '../test-support.js';
import { LocalStorageProvider } from './local-storage.provider.js';
import { isSafeStorageKey, StorageError } from './storage-provider.js';

/**
 * Storage is where a path becomes a real path, so most of this is about what it
 * refuses. A key is always server-generated, which is exactly why the checks
 * have to hold even for input that should never arrive.
 */

let root: string;
let storage: LocalStorageProvider;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'hadiya-storage-'));
  storage = new LocalStorageProvider(root);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('keys', () => {
  it('accepts the shape the service generates', () => {
    expect(isSafeStorageKey('images/68b8f00000000000000000aa/68b8f00000000000000000bb.png')).toBe(
      true,
    );
  });

  it('refuses anything that could climb out of the root', () => {
    for (const key of [
      '../secret.png',
      'images/../../etc/passwd',
      '/etc/passwd',
      'images/..%2Fsecret.png',
      'images\\..\\secret.png',
      './images/a.png',
      'images//a.png',
      '',
      `${'a'.repeat(300)}.png`,
    ]) {
      expect(isSafeStorageKey(key)).toBe(false);
    }
  });

  it('refuses a key with no extension or an absurd one', () => {
    expect(isSafeStorageKey('images/a')).toBe(false);
    expect(isSafeStorageKey('images/a.superlongextension')).toBe(false);
  });

  it('throws rather than touching the disk for an unsafe key', async () => {
    await expect(storage.put('../escape.png', PNG_PIXEL, 'image/png')).rejects.toThrow(
      StorageError,
    );
    await expect(storage.read('../escape.png')).rejects.toThrow(StorageError);
    await expect(storage.delete('../escape.png')).rejects.toThrow(StorageError);
  });
});

describe('storing and reading', () => {
  const key = 'images/68b8f00000000000000000aa/68b8f00000000000000000bb.png';

  it('round-trips bytes and remembers what they are', async () => {
    const stored = await storage.put(key, PNG_PIXEL, 'image/png');

    expect(stored).toEqual({ key, contentType: 'image/png', sizeBytes: PNG_PIXEL.byteLength });

    const read = await storage.read(key);
    expect(read.data.equals(PNG_PIXEL)).toBe(true);
    expect(read.contentType).toBe('image/png');
  });

  it('writes inside the root and nowhere else', async () => {
    await storage.put(key, PNG_PIXEL, 'image/png');

    const onDisk = await readFile(path.join(root, key));
    expect(onDisk.equals(PNG_PIXEL)).toBe(true);
  });

  it('refuses a content type it does not store', async () => {
    await expect(storage.put(key, PNG_PIXEL, 'text/html')).rejects.toThrow(StorageError);
    await expect(storage.put(key, PNG_PIXEL, 'image/svg+xml')).rejects.toThrow(StorageError);
  });

  it('reports a missing object rather than an empty one', async () => {
    expect(await storage.exists(key)).toBe(false);
    await expect(storage.read(key)).rejects.toThrow(/not in storage/);
  });

  it('does not leak the server path when an object is missing', async () => {
    await expect(storage.read(key)).rejects.toThrow(
      // The key, not the absolute location on disk.
      new RegExp(`"${key}"`),
    );
  });

  it('falls back to PNG rather than trusting a damaged sidecar', async () => {
    await storage.put(key, PNG_PIXEL, 'image/png');
    await writeFile(path.join(root, `${key}.meta.json`), 'not json');

    expect((await storage.read(key)).contentType).toBe('image/png');
  });

  it('deletes the object and its sidecar, and says whether there was one', async () => {
    await storage.put(key, PNG_PIXEL, 'image/png');

    expect(await storage.delete(key)).toBe(true);
    expect(await storage.exists(key)).toBe(false);
    // Deleting again is not an error; it is simply already gone.
    expect(await storage.delete(key)).toBe(false);
  });
});
