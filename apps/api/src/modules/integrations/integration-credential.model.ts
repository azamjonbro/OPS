import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * The encrypted half of an integration.
 *
 * Its own collection, and that separation is the design rather than tidiness.
 * The integration document is read by list endpoints, serialised into API
 * responses, copied into audit metadata and printed into logs; if a token lived
 * on it, every one of those paths would be one careless spread away from
 * leaking it. Here, a secret can only be obtained by asking for it by name,
 * from code that means to make an outbound call.
 *
 * `iv`, `authTag` and `keyId` are AES-GCM's own bookkeeping — see
 * `core/security/secret-box.ts`. None of them is secret; only `ciphertext` is,
 * and it is useless without the key from the environment.
 */
export interface IntegrationCredentialDocument {
  _id: Types.ObjectId;
  /** The integration this belongs to. Deleting one deletes this. */
  integration: Types.ObjectId;
  /**
   * Owner, duplicated from the integration on purpose.
   *
   * It means a credential read can be scoped to the actor in the same query
   * that finds it, instead of trusting that whoever passed the integration id
   * had already checked. Cheap redundancy against the one mistake here that
   * would matter.
   */
  user: Types.ObjectId;
  /** Which secret this is, e.g. `token`. One integration may hold several. */
  purpose: string;
  /** Base64 AES-256-GCM ciphertext. */
  ciphertext: string;
  /** Base64 nonce, fresh per encryption. */
  iv: string;
  /** Base64 GCM authentication tag. */
  authTag: string;
  /** Fingerprint of the key that sealed this, so a rotation is legible. */
  keyId: string;
  createdAt: Date;
  updatedAt: Date;
}

const credentialSchema = createSchema<IntegrationCredentialDocument>({
  integration: { type: Schema.Types.ObjectId, ref: 'Integration', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  purpose: { type: String, required: true, trim: true, maxlength: 40 },
  ciphertext: { type: String, required: true },
  iv: { type: String, required: true },
  authTag: { type: String, required: true },
  keyId: { type: String, required: true, maxlength: 32 },
});

// One secret per purpose per integration; storing a new one replaces the old.
credentialSchema.index({ integration: 1, purpose: 1 }, { unique: true });

/**
 * A credential must never be serialised.
 *
 * `createSchema` gives every model a `toJSON` that renders it for the wire, and
 * that is exactly the wrong default here: one `res.json(credential)` anywhere,
 * now or in five years, would publish a ciphertext and its authentication tag.
 * So this model's `toJSON` returns its id and nothing else, and the safety does
 * not depend on anyone remembering.
 */
credentialSchema.set('toJSON', {
  // Both parameters are `unknown` for the same reason as in `create-schema.ts`:
  // Mongoose types a transform's arguments with conditional types over the
  // document, and nothing narrower is assignable while those stay unresolved.
  transform: (_document: unknown, record: unknown) => ({
    id: String((record as { _id?: unknown })._id),
  }),
});

export const IntegrationCredentialModel: Model<IntegrationCredentialDocument> =
  model<IntegrationCredentialDocument>('IntegrationCredential', credentialSchema);
