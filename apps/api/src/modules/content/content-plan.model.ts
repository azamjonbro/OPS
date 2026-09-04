import {
  CONTENT_PLAN_STATUSES,
  CONTENT_PLATFORMS,
  type ContentPlanStatus,
  type ContentPlatform,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * A campaign: a titled stretch of days on one platform.
 *
 * The items are their own collection rather than an embedded array, and that is
 * the central decision in this module. A plan is edited one day at a time —
 * "3-kunni o'zgartir", "captionni qisqartir" — and an embedded array turns each
 * of those into a rewrite of the whole document: the whole plan re-validated,
 * the whole plan re-sent, and two people editing different days able to clobber
 * each other. Separate documents make a one-day edit a one-document write.
 *
 * `itemCount` is denormalised for the same reason a conversation keeps its
 * message count: the list screen would otherwise need a count query per row.
 */
export interface ContentPlanDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: string;
  description: string | null;
  platform: ContentPlatform;
  startDate: Date;
  endDate: Date;
  status: ContentPlanStatus;
  itemCount: number;
  conversation: Types.ObjectId | null;
  /** The brief, and any business figures the plan was generated from. */
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const contentPlanSchema = createSchema<ContentPlanDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, default: null, trim: true, maxlength: 2_000 },
  platform: { type: String, required: true, enum: CONTENT_PLATFORMS },
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  status: { type: String, required: true, enum: CONTENT_PLAN_STATUSES, default: 'draft' },
  itemCount: { type: Number, required: true, default: 0, min: 0 },
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', default: null },
  metadata: { type: Schema.Types.Mixed, required: true, default: {} },
});

// The only list there is: this user's plans, most recent first. Scoping every
// query by `user` is what keeps them private.
contentPlanSchema.index({ user: 1, status: 1, startDate: -1 });
// Finding the plan that covers a date, for "bugungi post".
contentPlanSchema.index({ user: 1, startDate: 1, endDate: 1 });

export const ContentPlanModel: Model<ContentPlanDocument> = model<ContentPlanDocument>(
  'ContentPlan',
  contentPlanSchema,
);
