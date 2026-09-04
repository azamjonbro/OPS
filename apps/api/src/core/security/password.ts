import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Password hashing with scrypt from Node's own crypto module — memory-hard,
 * and it avoids a native build step in every deployment image.
 *
 * The stored format is self-describing so parameters can be raised later
 * without invalidating existing hashes:
 *
 *   scrypt$<N>$<r>$<p>$<salt-base64>$<hash-base64>
 */
const ALGORITHM = 'scrypt';
const COST = 16_384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const FIELD_COUNT = 6;

const derive = (
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelism: number,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(
      password.normalize('NFKC'),
      salt,
      KEY_BYTES,
      {
        N: cost,
        r: blockSize,
        p: parallelism,
        // scrypt needs roughly 128 * N * r bytes; the default limit is below that.
        maxmem: 256 * cost * blockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(derivedKey);
      },
    );
  });

export const hashPassword = async (password: string): Promise<string> => {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISM);

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELISM,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
};

/**
 * Compares a candidate password against a stored hash in constant time.
 * A malformed stored value is a failed verification, never a thrown error, so
 * a corrupted record cannot turn into a 500 on the login path.
 */
export const verifyPassword = async (password: string, stored: string): Promise<boolean> => {
  const parts = stored.split('$');

  if (parts.length !== FIELD_COUNT || parts[0] !== ALGORITHM) {
    return false;
  }

  const [, costRaw, blockSizeRaw, parallelismRaw, saltRaw, hashRaw] = parts;
  const cost = Number(costRaw);
  const blockSize = Number(blockSizeRaw);
  const parallelism = Number(parallelismRaw);

  if (!Number.isInteger(cost) || !Number.isInteger(blockSize) || !Number.isInteger(parallelism)) {
    return false;
  }

  const salt = Buffer.from(saltRaw ?? '', 'base64');
  const expected = Buffer.from(hashRaw ?? '', 'base64');

  if (salt.length === 0 || expected.length !== KEY_BYTES) {
    return false;
  }

  const candidate = await derive(password, salt, cost, blockSize, parallelism);

  return timingSafeEqual(candidate, expected);
};
