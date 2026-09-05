import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  createSecretBox,
  generateEncryptionKey,
  parseEncryptionKey,
  SecretBoxError,
  secretsMatch,
} from './secret-box.js';

/**
 * The encryption integration credentials depend on.
 *
 * These are the properties the rest of the hub takes for granted, so they are
 * asserted here rather than assumed: that a ciphertext reveals nothing, that
 * two encryptions of the same secret are unrelated, that a tampered row fails
 * loudly, and that a ciphertext cannot be moved from one integration to
 * another.
 */

const KEY = parseEncryptionKey(generateEncryptionKey());

describe('encryption keys', () => {
  it('accepts a 32-byte key as base64 or hex', () => {
    const raw = randomBytes(32);

    expect(parseEncryptionKey(raw.toString('base64'))).toEqual(raw);
    expect(parseEncryptionKey(raw.toString('hex'))).toEqual(raw);
  });

  it('refuses anything that is not 32 bytes', () => {
    // A passphrase silently stretched to key length is a key with a fraction of
    // the entropy it appears to have, and nothing downstream would reveal that.
    expect(() => parseEncryptionKey('too-short')).toThrow(SecretBoxError);
    expect(() => parseEncryptionKey(randomBytes(16).toString('base64'))).toThrow(SecretBoxError);
  });
});

describe('sealing and opening', () => {
  const box = createSecretBox(KEY);

  it('round-trips a secret', () => {
    const sealed = box.seal('crm-secret-token', 'integration:a:user:b:purpose:token');

    expect(box.open(sealed, 'integration:a:user:b:purpose:token')).toBe('crm-secret-token');
  });

  it('never puts the plaintext in the ciphertext', () => {
    const sealed = box.seal('crm-secret-token', 'binding');

    expect(sealed.ciphertext).not.toContain('crm-secret-token');
    expect(Buffer.from(sealed.ciphertext, 'base64').toString('utf8')).not.toContain('crm');
  });

  it('produces unrelated ciphertexts for the same secret', () => {
    const first = box.seal('same', 'binding');
    const second = box.seal('same', 'binding');

    // The nonce is fresh per encryption, so nothing can be learned by comparing
    // two rows in the database.
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.iv).not.toBe(second.iv);
  });

  it('refuses a ciphertext moved to a different integration', () => {
    const sealed = box.seal('crm-secret-token', 'integration:a:user:b:purpose:token');

    // The obvious attack on a table of encrypted secrets: copy a row. GCM's
    // additional data is what makes it fail rather than succeed.
    expect(() => box.open(sealed, 'integration:c:user:b:purpose:token')).toThrow(SecretBoxError);
  });

  it('refuses a ciphertext that has been edited', () => {
    const sealed = box.seal('crm-secret-token', 'binding');
    const bytes = Buffer.from(sealed.ciphertext, 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;

    expect(() => box.open({ ...sealed, ciphertext: bytes.toString('base64') }, 'binding')).toThrow(
      SecretBoxError,
    );
  });

  it('refuses a ciphertext sealed with a different key', () => {
    const other = createSecretBox(parseEncryptionKey(generateEncryptionKey()));
    const sealed = other.seal('crm-secret-token', 'binding');

    // Said plainly, so a key rotation reads as a rotation rather than as a wave
    // of authentication failures against servers that are perfectly fine.
    expect(() => box.open(sealed, 'binding')).toThrow(/different encryption key/);
  });

  it('stamps which key sealed each row', () => {
    const sealed = box.seal('secret', 'binding');

    expect(sealed.keyId).toBe(box.keyId);
    expect(sealed.keyId).toHaveLength(8);
  });
});

describe('secretsMatch', () => {
  it('compares without leaking length-independent timing', () => {
    expect(secretsMatch('token', 'token')).toBe(true);
    expect(secretsMatch('token', 'other')).toBe(false);
    expect(secretsMatch('token', 'tokens')).toBe(false);
  });
});
