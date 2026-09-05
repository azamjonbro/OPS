import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Authenticated encryption for secrets Hadiya has to keep rather than hash.
 *
 * Passwords are hashed and never recovered; an integration credential is not
 * like that. Hadiya must present the actual bearer token to the actual server
 * on every call, so the plaintext has to come back — which makes this
 * encryption, not hashing, and makes the key the whole of the security.
 *
 * AES-256-GCM, so a ciphertext is authenticated as well as hidden: a row edited
 * in the database fails to decrypt instead of decrypting to something else. The
 * nonce is random per encryption and stored beside the ciphertext, so the same
 * token encrypted twice produces two unrelated rows and nothing can be learned
 * by comparing them.
 *
 * `aad` binds a ciphertext to where it belongs. Passing the credential's own id
 * means a row copied from one integration to another — the obvious attack on a
 * table of encrypted secrets — fails authentication rather than handing the
 * thief a working token for somebody else's server.
 */
const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

export interface SealedSecret {
  /** Base64. */
  ciphertext: string;
  /** Base64 nonce, unique per encryption. */
  iv: string;
  /** Base64 GCM authentication tag. */
  authTag: string;
  /** Which key sealed this, so a rotation can tell old rows from new. */
  keyId: string;
}

export class SecretBoxError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SecretBoxError';
  }
}

/**
 * Reads a configured key.
 *
 * Accepts base64 or hex and insists on exactly 32 bytes rather than stretching
 * whatever it was given: a passphrase silently padded to key length is a key
 * with a fraction of the entropy it appears to have, and nothing downstream
 * would ever reveal that.
 */
export const parseEncryptionKey = (value: string): Buffer => {
  const trimmed = value.trim();

  const decoded = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');

  if (decoded.length !== KEY_BYTES) {
    throw new SecretBoxError(
      `An encryption key must be ${KEY_BYTES} bytes, base64 or hex encoded (got ${decoded.length})`,
    );
  }

  return decoded;
};

/** A short, non-secret fingerprint, so rows can name their key without naming it. */
const fingerprint = (key: Buffer): string => {
  // A fold of the key's own bytes: enough to tell two keys apart in a row, far
  // too little to say anything about either.
  let hash = 0x811c9dc5;

  for (const byte of key) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }

  return hash.toString(16).padStart(8, '0');
};

export interface SecretBox {
  readonly keyId: string;
  seal: (plaintext: string, aad: string) => SealedSecret;
  open: (sealed: SealedSecret, aad: string) => string;
}

export const createSecretBox = (key: Buffer): SecretBox => {
  if (key.length !== KEY_BYTES) {
    throw new SecretBoxError(`An encryption key must be ${KEY_BYTES} bytes`);
  }

  const keyId = fingerprint(key);

  return {
    keyId,

    seal: (plaintext, aad) => {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, key, iv);

      cipher.setAAD(Buffer.from(aad, 'utf8'));

      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

      return {
        ciphertext: ciphertext.toString('base64'),
        iv: iv.toString('base64'),
        authTag: cipher.getAuthTag().toString('base64'),
        keyId,
      };
    },

    open: (sealed, aad) => {
      // A row sealed by a different key cannot be opened by this one. Saying so
      // plainly turns a key rotation into a legible error rather than into a
      // wave of "authentication failed" against servers that are perfectly fine.
      if (sealed.keyId !== keyId) {
        throw new SecretBoxError('This secret was sealed with a different encryption key');
      }

      const authTag = Buffer.from(sealed.authTag, 'base64');

      if (authTag.length !== AUTH_TAG_BYTES) {
        throw new SecretBoxError('The stored secret is malformed');
      }

      try {
        const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(sealed.iv, 'base64'));

        decipher.setAAD(Buffer.from(aad, 'utf8'));
        decipher.setAuthTag(authTag);

        return Buffer.concat([
          decipher.update(Buffer.from(sealed.ciphertext, 'base64')),
          decipher.final(),
        ]).toString('utf8');
      } catch (error) {
        // GCM's own failure message says nothing useful and everything risky.
        throw new SecretBoxError('The stored secret could not be decrypted', { cause: error });
      }
    },
  };
};

/**
 * Constant-time comparison, for the rare place two secrets are compared rather
 * than used. Kept here so nothing elsewhere reaches for `===` on a token.
 */
export const secretsMatch = (a: string, b: string): boolean => {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');

  return left.length === right.length && timingSafeEqual(left, right);
};

/** Generates a fresh key, for `.env.example` and for the rotation runbook. */
export const generateEncryptionKey = (): string => randomBytes(KEY_BYTES).toString('base64');
