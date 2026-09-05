import type { Types } from 'mongoose';

import { config } from '../../config/index.js';
import { toObjectId } from '../../core/db/object-id.js';
import { ApiError } from '../../core/http/api-error.js';
import { createLogger } from '../../core/logger/logger.js';
import {
  createSecretBox,
  parseEncryptionKey,
  SecretBoxError,
  type SecretBox,
} from '../../core/security/secret-box.js';
import { IntegrationCredentialModel } from './integration-credential.model.js';

const log = createLogger('integration-credentials');

/**
 * The only code in Hadiya that handles an integration secret in the clear.
 *
 * Everything above it deals in "is there a credential?" and "make this call";
 * the plaintext exists here, on the stack, for the length of one outbound
 * request. There is deliberately no `getSecret` for a controller to reach for —
 * see `withSecret` below.
 */

/** The purposes a secret can be stored under. */
export const CREDENTIAL_PURPOSE = {
  /** Bearer token, API key or header value, depending on the auth method. */
  token: 'token',
} as const;

export type CredentialPurpose = (typeof CREDENTIAL_PURPOSE)[keyof typeof CREDENTIAL_PURPOSE];

let box: SecretBox | null = null;

/**
 * The process's secret box, built once from the environment.
 *
 * No key means no storage, and that is a refusal rather than a fallback: an
 * integration that quietly saved a token in the clear because the deployment
 * forgot a variable is precisely the failure this module exists to prevent. In
 * production `env.ts` will not let the process start without one at all.
 */
const getBox = (): SecretBox => {
  if (box) {
    return box;
  }

  const key = config.credentials.encryptionKey;

  if (!key) {
    throw ApiError.dependencyUnavailable(
      'This deployment cannot store integration credentials: no encryption key is configured.',
    );
  }

  try {
    box = createSecretBox(parseEncryptionKey(key));
  } catch (error) {
    // The message names the variable, never its value.
    log.error({ err: error }, 'CREDENTIALS_ENCRYPTION_KEY is not a usable key');

    throw ApiError.dependencyUnavailable(
      'This deployment cannot store integration credentials: the encryption key is not valid.',
    );
  }

  return box;
};

/** Testing seam: forces the key to be re-read. */
export const resetSecretBox = (): void => {
  box = null;
};

/** Whether a credential can be stored at all, for the provider catalogue. */
export const canStoreCredentials = (): boolean => config.credentials.configured;

/**
 * What a ciphertext is bound to.
 *
 * Both ids, so a row lifted from one integration to another — or from one
 * account to another — fails authentication instead of decrypting into a
 * working token for somebody else's server.
 */
const bindingFor = (integrationId: string, userId: string, purpose: string): string =>
  `integration:${integrationId}:user:${userId}:purpose:${purpose}`;

export interface StoreSecretInput {
  integrationId: string;
  userId: string;
  purpose: CredentialPurpose;
  secret: string;
}

/** Encrypts a secret and replaces whatever that purpose held before. */
export const storeSecret = async (input: StoreSecretInput): Promise<void> => {
  const sealed = getBox().seal(
    input.secret,
    bindingFor(input.integrationId, input.userId, input.purpose),
  );

  await IntegrationCredentialModel.findOneAndUpdate(
    { integration: toObjectId(input.integrationId), purpose: input.purpose },
    {
      $set: { ...sealed, user: toObjectId(input.userId) },
      $setOnInsert: { integration: toObjectId(input.integrationId), purpose: input.purpose },
    },
    { upsert: true, returnDocument: 'after', runValidators: true },
  ).exec();
};

/** Whether a secret is on file, which is all any read path needs to know. */
export const hasSecret = async (
  integrationId: string,
  purpose: CredentialPurpose,
): Promise<boolean> =>
  (await IntegrationCredentialModel.exists({
    integration: toObjectId(integrationId),
    purpose,
  }).exec()) !== null;

export const hasAnySecret = async (integrationId: string): Promise<boolean> =>
  (await IntegrationCredentialModel.exists({ integration: toObjectId(integrationId) }).exec()) !==
  null;

/**
 * Runs something with a decrypted secret, and does not hand it out.
 *
 * A `getSecret(id)` would make the plaintext a value like any other — assignable
 * to a variable, spreadable into an object, includable in a log line, returnable
 * from a controller that meant well. Scoping it to a callback keeps its lifetime
 * visible in the shape of the code: it exists inside these braces and nowhere
 * else.
 *
 * The lookup is scoped to the owner as well as to the integration, so a caller
 * that got an id wrong finds nothing rather than someone else's token.
 */
export const withSecret = async <TResult>(
  params: { integrationId: string; userId: string; purpose: CredentialPurpose },
  use: (secret: string) => Promise<TResult> | TResult,
): Promise<TResult> => {
  const stored = await IntegrationCredentialModel.findOne({
    integration: toObjectId(params.integrationId),
    user: toObjectId(params.userId),
    purpose: params.purpose,
  })
    .lean<{
      ciphertext: string;
      iv: string;
      authTag: string;
      keyId: string;
      _id: Types.ObjectId;
    } | null>()
    .exec();

  if (!stored) {
    throw ApiError.badRequest('This integration has no stored credential.');
  }

  let secret: string;

  try {
    secret = getBox().open(stored, bindingFor(params.integrationId, params.userId, params.purpose));
  } catch (error) {
    if (error instanceof SecretBoxError) {
      log.error(
        { integrationId: params.integrationId, err: error },
        'stored credential could not be decrypted',
      );

      // What went wrong is a deployment problem — a rotated key, a tampered
      // row — and neither reading is safe to spell out to a client.
      throw ApiError.dependencyUnavailable(
        'This integration needs to be reconnected: its saved credential could not be read.',
      );
    }

    throw error;
  }

  return use(secret);
};

/**
 * Destroys every secret an integration holds.
 *
 * Called when the integration is deleted and when it is disconnected, so
 * "disconnect" means the token is gone rather than merely unused. Reconnecting
 * asks for it again, which is the honest behaviour: a person who disconnects a
 * CRM has withdrawn Hadiya's access to it.
 */
export const revokeSecrets = async (integrationId: string): Promise<number> => {
  const result = await IntegrationCredentialModel.deleteMany({
    integration: toObjectId(integrationId),
  }).exec();

  return result.deletedCount ?? 0;
};
