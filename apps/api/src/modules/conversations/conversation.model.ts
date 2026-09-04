import { CONVERSATION_STATUSES, type ConversationStatus } from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

/**
 * A chat thread. Messages live in their own collection: a conversation can run
 * to thousands of turns, and embedding them would grow one document without
 * bound and force every list read to drag the whole history with it.
 */
export interface ConversationDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: string;
  status: ConversationStatus;
  /** Denormalised so the list can sort without touching the messages. */
  lastMessageAt: Date | null;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const conversationSchema = createSchema<ConversationDocument>({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true, trim: true, maxlength: 120 },
  status: { type: String, required: true, enum: CONVERSATION_STATUSES, default: 'active' },
  lastMessageAt: { type: Date, default: null },
  messageCount: { type: Number, required: true, default: 0 },
});

// The only read there is: this user's conversations, most recently used first.
// Every query is scoped by `user`, which is what keeps threads private.
conversationSchema.index({ user: 1, status: 1, lastMessageAt: -1 });

export const ConversationModel: Model<ConversationDocument> = model<ConversationDocument>(
  'Conversation',
  conversationSchema,
);
