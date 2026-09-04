import { Schema, type SchemaDefinition, type SchemaDefinitionType } from 'mongoose';

/**
 * The schema options a module may choose for itself.
 *
 * Deliberately a small, hand-picked subset rather than Mongoose's full
 * `SchemaOptions`: the wire shape of a document (`toJSON`/`toObject`),
 * timestamps and the version key are platform-wide contracts, so a module must
 * not be able to override them. Widen this as real modules need more.
 */
export interface CreateSchemaOptions {
  /** Explicit collection name; by default Mongoose pluralises the model name. */
  collection?: string;
  /** Field used to tell discriminated sub-schemas apart. */
  discriminatorKey?: string;
  /** Reject (`'throw'`) or drop (`true`) paths that are not in the schema. */
  strict?: boolean | 'throw';
  /** Whether unknown paths in a query filter are dropped. */
  strictQuery?: boolean | 'throw';
  /** Keep empty objects instead of removing them on save. */
  minimize?: boolean;
  /** Build the schema's indexes on start-up. Off in production deployments. */
  autoIndex?: boolean;
}

/**
 * Replaces `_id` with a string `id` so persistence details never reach the
 * wire, and drops `__v`.
 *
 * Applied to `toJSON` only. `toObject` is how server code turns a hydrated
 * document into a plain one — services and repositories go on reading `_id`
 * there, and the response layer (`toApiPayload`) does the renaming for every
 * payload, lean reads included.
 *
 * Both parameters are `unknown` because Mongoose describes the transform's
 * arguments with conditional types over the schema's document type; while
 * `TDocument` is still generic those stay unresolved, and nothing narrower is
 * assignable to them.
 */
const serializeDocument = (_document: unknown, record: unknown): Record<string, unknown> => {
  const { _id: id, __v: _version, ...rest } = record as Record<string, unknown>;

  return { id: id === undefined || id === null ? id : String(id), ...rest };
};

/** Left un-annotated so it stays assignable to Mongoose's generic option type. */
const serialization = { virtuals: true, transform: serializeDocument };

/**
 * Every Hadiya collection is declared through this factory, so timestamps and
 * JSON serialisation are identical across modules instead of being repeated in
 * each model file.
 */
export const createSchema = <TDocument>(
  definition: SchemaDefinition<SchemaDefinitionType<TDocument>, TDocument>,
  options: CreateSchemaOptions = {},
): Schema<TDocument> => {
  const schema = new Schema<TDocument>(definition, {
    timestamps: true,
    versionKey: false,
    ...options,
  });

  schema.set('toJSON', serialization);

  return schema;
};
