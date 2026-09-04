import {
  CONTENT_ITEM_STATUSES,
  CONTENT_PLATFORMS,
  CONTENT_TYPES,
  type ContentItemStatus,
  type ContentPlatform,
  type ContentType,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * One scheduled piece of content.
 *
 * `user` is denormalised from the plan so an item can be authorised — and
 * listed, and deleted with its owner — without joining back to the plan on
 * every read. Every query still filters on it, so the ownership check and the
 * lookup are the same operation.
 *
 * `caption` is nullable on purpose: an item can exist as a topic long before
 * anyone writes the copy, and forcing an empty string would make "not written
 * yet" indistinguishable from "deliberately blank".
 */
export interface ContentItemDocument {
  _id: Types.ObjectId;
  plan: Types.ObjectId;
  user: Types.ObjectId;
  date: Date;
  platform: ContentPlatform;
  contentType: ContentType;
  title: string;
  idea: string;
  caption: string | null;
  callToAction: string | null;
  /** Stored without the leading `#` so a client renders them as it likes. */
  hashtags: string[];
  status: ContentItemStatus;
  notes: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const contentItemSchema = createSchema<ContentItemDocument>({
  plan: { type: Schema.Types.ObjectId, ref: 'ContentPlan', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  platform: { type: String, required: true, enum: CONTENT_PLATFORMS },
  contentType: { type: String, required: true, enum: CONTENT_TYPES },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  idea: { type: String, required: true, trim: true, maxlength: 2_000 },
  caption: { type: String, default: null, trim: true, maxlength: 4_000 },
  callToAction: { type: String, default: null, trim: true, maxlength: 300 },
  hashtags: { type: [{ type: String, trim: true, maxlength: 60 }], default: [] },
  status: { type: String, required: true, enum: CONTENT_ITEM_STATUSES, default: 'idea' },
  notes: { type: String, default: null, trim: true, maxlength: 2_000 },
  metadata: { type: Schema.Types.Mixed, required: true, default: {} },
});

// Reading a plan is always "its items, in date order".
contentItemSchema.index({ plan: 1, date: 1 });
// And "what am I posting today", across every plan the user owns.
contentItemSchema.index({ user: 1, date: 1, status: 1 });

export const ContentItemModel: Model<ContentItemDocument> = model<ContentItemDocument>(
  'ContentItem',
  contentItemSchema,
);
