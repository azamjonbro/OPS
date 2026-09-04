import {
  MESSAGE_ROLES,
  TOOL_CALL_STATUSES,
  type MessageRole,
  type ToolCallStatus,
} from '@hadiya/shared';
import { model, Schema, type Model, type Types } from 'mongoose';

import { createSchema } from '../../core/db/create-schema.js';

export interface MessageToolCallSubdocument {
  callId: string;
  name: string;
  arguments: Record<string, unknown>;
  status: ToolCallStatus;
  result: string | null;
  durationMs: number | null;
}

export interface MessageDocument {
  _id: Types.ObjectId;
  conversation: Types.ObjectId;
  /**
   * Denormalised from the conversation so a message can be authorised — and
   * deleted with its owner — without a join on every read.
   */
  user: Types.ObjectId;
  role: MessageRole;
  content: string;
  toolCalls: MessageToolCallSubdocument[];
  toolCallId: string | null;
  model: string | null;
  usage: { promptTokens: number | null; completionTokens: number | null } | null;
  createdAt: Date;
  updatedAt: Date;
}

const toolCallSchema = new Schema<MessageToolCallSubdocument>(
  {
    callId: { type: String, required: true, trim: true, maxlength: 120 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    // Free-form because each tool defines its own arguments; the tool's schema
    // has already validated them before they get here.
    arguments: { type: Schema.Types.Mixed, required: true, default: {} },
    status: { type: String, required: true, enum: TOOL_CALL_STATUSES },
    result: { type: String, default: null, maxlength: 4_000 },
    durationMs: { type: Number, default: null },
  },
  { _id: false },
);

const usageSchema = new Schema<NonNullable<MessageDocument['usage']>>(
  {
    promptTokens: { type: Number, default: null },
    completionTokens: { type: Number, default: null },
  },
  { _id: false },
);

const messageSchema = createSchema<MessageDocument>({
  conversation: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  role: { type: String, required: true, enum: MESSAGE_ROLES },
  // Not `required`: an assistant turn that only asks for tools genuinely has
  // no text, and Mongoose treats an empty string as a missing required value.
  content: { type: String, default: '', maxlength: 32_000 },
  toolCalls: { type: [toolCallSchema], default: [] },
  toolCallId: { type: String, default: null, trim: true, maxlength: 120 },
  model: { type: String, default: null, trim: true, maxlength: 80 },
  usage: { type: usageSchema, default: null },
});

// Reading a thread is always "this conversation, newest first" — for the
// transcript and for the context builder's recent-message window alike.
messageSchema.index({ conversation: 1, createdAt: -1 });
// Used when a user is removed and their messages go with them.
messageSchema.index({ user: 1, createdAt: -1 });

export const MessageModel: Model<MessageDocument> = model<MessageDocument>(
  'Message',
  messageSchema,
);
