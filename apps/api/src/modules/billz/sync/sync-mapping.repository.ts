import { createHash } from 'node:crypto';

import type { Types } from 'mongoose';

import {
  IntegrationMappingModel,
  type IntegrationMappingDocument,
  type MappedResource,
} from './integration-mapping.model.js';

/** Stable fingerprint of what was last written, so unchanged rows are skipped. */
export const hashPayload = (payload: unknown): string =>
  createHash('sha1').update(JSON.stringify(payload)).digest('hex');

/**
 * The external-ID mapping table.
 *
 * Every lookup goes through here, so no caller is ever tempted to treat a Billz
 * id as a Mongo `_id` — the two never meet outside this file.
 */
export const findMappingByExternalId = async (
  resource: MappedResource,
  externalId: string,
): Promise<IntegrationMappingDocument | null> =>
  IntegrationMappingModel.findOne({ source: 'billz', resource, externalId })
    .lean<IntegrationMappingDocument | null>()
    .exec();

export const findMappingsByExternalIds = async (
  resource: MappedResource,
  externalIds: string[],
): Promise<Map<string, IntegrationMappingDocument>> => {
  const mappings = await IntegrationMappingModel.find({
    source: 'billz',
    resource,
    externalId: { $in: externalIds },
  })
    .lean<IntegrationMappingDocument[]>()
    .exec();

  return new Map(mappings.map((mapping) => [mapping.externalId, mapping]));
};

export const findLocalId = async (
  resource: MappedResource,
  externalId: string,
): Promise<Types.ObjectId | null> =>
  (await findMappingByExternalId(resource, externalId))?.localId ?? null;

export interface UpsertMappingInput {
  resource: MappedResource;
  externalId: string;
  localId: Types.ObjectId;
  contentHash: string;
  externalUpdatedAt: Date | null;
}

export const upsertMapping = async (input: UpsertMappingInput): Promise<void> => {
  await IntegrationMappingModel.updateOne(
    { source: 'billz', resource: input.resource, externalId: input.externalId },
    {
      $set: {
        localId: input.localId,
        contentHash: input.contentHash,
        externalUpdatedAt: input.externalUpdatedAt,
        syncedAt: new Date(),
      },
    },
    { upsert: true },
  ).exec();
};

export const countMappings = async (resource: MappedResource): Promise<number> =>
  IntegrationMappingModel.countDocuments({ source: 'billz', resource }).exec();
