import {
  IMAGE_ASPECT_RATIOS,
  IMAGE_ASSET_STATUSES,
  IMAGE_CONTENT_TYPES,
  IMAGE_QUALITIES,
  IMAGE_STYLES,
  type ImageAspectRatio,
  type ImageAssetStatus,
  type ImageQuality,
  type ImageStyle,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One generated image.
 *
 * The row holds *where* the bytes are, never the bytes themselves: a document
 * store is the wrong place for megabytes, and every query that listed a
 * gallery would drag them along. `storageKey` is opaque and server-chosen —
 * nothing a client sends ever becomes part of it.
 *
 * There is deliberately no provider URL here. Some models answer with a signed
 * link that expires within the hour, so an asset pointing at one would quietly
 * become a broken image in a plan somebody wrote weeks earlier. The bytes are
 * copied into storage before the row is completed, and `url` is Hadiya's own
 * authenticated path to them.
 */
export interface ImageAssetDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  prompt: string;
  revisedPrompt: string | null;
  provider: string;
  model: string | null;
  status: ImageAssetStatus;
  width: number | null;
  height: number | null;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality | null;
  style: ImageStyle | null;
  storageKey: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  contentItem: Types.ObjectId | null;
  conversation: Types.ObjectId | null;
  failureReason: string | null;
  /**
   * The brief, the product it was based on. Never a credential: what goes in
   * here is chosen by the service, never copied wholesale from a provider
   * response or from configuration.
   */
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const imageAssetSchema = createSchema<ImageAssetDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  prompt: { type: String, required: true, trim: true, maxlength: 1_500 },
  revisedPrompt: { type: String, default: null, trim: true, maxlength: 4_000 },
  provider: { type: String, required: true, trim: true, maxlength: 40 },
  model: { type: String, default: null, trim: true, maxlength: 80 },
  status: { type: String, required: true, enum: IMAGE_ASSET_STATUSES, default: 'generating' },
  width: { type: Number, default: null, min: 0 },
  height: { type: Number, default: null, min: 0 },
  aspectRatio: { type: String, required: true, enum: IMAGE_ASPECT_RATIOS },
  quality: { type: String, default: null, enum: [...IMAGE_QUALITIES, null] },
  style: { type: String, default: null, enum: [...IMAGE_STYLES, null] },
  storageKey: { type: String, default: null, trim: true, maxlength: 200 },
  contentType: { type: String, default: null, enum: [...IMAGE_CONTENT_TYPES, null] },
  sizeBytes: { type: Number, default: null, min: 0 },
  contentItem: { type: Schema.Types.ObjectId, ref: 'ContentItem', default: null },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
  failureReason: { type: String, default: null, maxlength: 500 },
  metadata: { type: Schema.Types.Mixed, required: true, default: {} },
});

// The gallery: this user's images, newest first. Scoping by `user` is what
// keeps them private.
imageAssetSchema.index({ user: 1, status: 1, createdAt: -1 });
// The images attached to one day of a plan.
imageAssetSchema.index({ user: 1, contentItem: 1, createdAt: -1 });

export const ImageAssetModel: Model<ImageAssetDocument> = model<ImageAssetDocument>(
  'ImageAsset',
  imageAssetSchema,
);
