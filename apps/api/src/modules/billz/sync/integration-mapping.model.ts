import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../../core/db/create-schema.js';

/** Resources Hadiya links to an external system. */
export const MAPPED_RESOURCES = ['product', 'category', 'customer', 'branch'] as const;

export type MappedResource = (typeof MAPPED_RESOURCES)[number];

/**
 * The link between a Hadiya record and its counterpart in an external system.
 *
 * Kept in its own collection rather than as a field on each entity so that a
 * Billz id is never confused with a Mongo `_id`, and so the mapping can be
 * inspected, repaired or re-pointed without touching business data. The unique
 * indexes make the relationship one-to-one in both directions: a Billz product
 * maps to exactly one Hadiya product and vice versa, which is what makes a sync
 * safe to re-run.
 */
export interface IntegrationMappingDocument {
  _id: Types.ObjectId;
  source: 'billz';
  resource: MappedResource;
  /** The id as the external system knows it. */
  externalId: string;
  /** The Hadiya document this refers to. */
  localId: Types.ObjectId;
  /** Hash of the payload last written, so an unchanged record is skipped. */
  contentHash: string | null;
  /** ISO timestamp the external record last reported being changed. */
  externalUpdatedAt: Date | null;
  syncedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const integrationMappingSchema = createSchema<IntegrationMappingDocument>({
  source: { type: String, required: true, enum: ['billz'] },
  resource: { type: String, required: true, enum: MAPPED_RESOURCES },
  externalId: { type: String, required: true, trim: true },
  localId: { type: Schema.Types.ObjectId, required: true },
  contentHash: { type: String, default: null },
  externalUpdatedAt: { type: Date, default: null },
  syncedAt: { type: Date, required: true },
});

// One external record maps to one local record...
integrationMappingSchema.index({ source: 1, resource: 1, externalId: 1 }, { unique: true });
// ...and one local record is claimed by at most one external record.
integrationMappingSchema.index({ source: 1, resource: 1, localId: 1 }, { unique: true });

export const IntegrationMappingModel: Model<IntegrationMappingDocument> =
  model<IntegrationMappingDocument>('IntegrationMapping', integrationMappingSchema);
