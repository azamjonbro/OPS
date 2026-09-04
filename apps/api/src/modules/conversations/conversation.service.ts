import {
  buildPaginationMeta,
  CONVERSATION_TITLE_MAX_LENGTH,
  resolvePagination,
  type AuthenticatedUser,
  type ConversationStatus,
  type MessageRole,
  type PaginatedResult,
} from '@hadiya/shared';
import type { ClientSession } from 'mongoose';

import { toObjectId } from '../../core/db/object-id.js';
import { runInTransaction } from '../../core/db/transaction.js';
import { ApiError } from '../../core/http/api-error.js';
import { ConversationModel, type ConversationDocument } from './conversation.model.js';
import {
  MessageModel,
  type MessageDocument,
  type MessageToolCallSubdocument,
} from './message.model.js';

/**
 * Conversations belong to one person and are never shared, so every read and
 * write here filters on the actor's id.
 *
 * That filter is the authorisation: a query that cannot match another user's
 * row cannot leak it, which is safer than fetching a document and then deciding
 * whether the caller was allowed to see it.
 */
const ownedBy = (actor: AuthenticatedUser, id?: string): Record<string, unknown> => ({
  ...(id ? { _id: id } : {}),
  user: toObjectId(actor.id),
});

/** First line of the opening message, which is a better name than "New chat". */
export const deriveTitle = (firstMessage: string): string => {
  const firstLine = firstMessage.trim().split('\n')[0]?.trim() ?? '';

  if (firstLine.length === 0) {
    return 'New conversation';
  }

  if (firstLine.length <= CONVERSATION_TITLE_MAX_LENGTH) {
    return firstLine;
  }

  // Cut on a word boundary where there is one nearby, so a title does not end
  // mid-word.
  const clipped = firstLine.slice(0, CONVERSATION_TITLE_MAX_LENGTH);
  const lastSpace = clipped.lastIndexOf(' ');

  return `${(lastSpace > CONVERSATION_TITLE_MAX_LENGTH / 2 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

export const createConversation = async (
  actor: AuthenticatedUser,
  input: { title?: string | undefined },
): Promise<ConversationDocument> => {
  const created = await ConversationModel.create({
    user: toObjectId(actor.id),
    title: input.title?.trim() || 'New conversation',
    status: 'active',
    lastMessageAt: null,
    messageCount: 0,
  });

  return created.toObject<ConversationDocument>();
};

export const getConversation = async (
  actor: AuthenticatedUser,
  id: string,
  session?: ClientSession,
): Promise<ConversationDocument> => {
  const conversation = await ConversationModel.findOne(ownedBy(actor, id))
    .session(session ?? null)
    .lean<ConversationDocument | null>()
    .exec();

  if (!conversation) {
    // Someone else's conversation is reported as missing rather than
    // forbidden: a 403 would confirm that the id exists.
    throw ApiError.notFound('Conversation not found');
  }

  return conversation;
};

export interface ListConversationsQuery {
  page: number;
  pageSize: number;
  status?: ConversationStatus | undefined;
  search?: string | undefined;
}

export const listConversations = async (
  actor: AuthenticatedUser,
  query: ListConversationsQuery,
): Promise<PaginatedResult<ConversationDocument>> => {
  const filter: Record<string, unknown> = {
    ...ownedBy(actor),
    // Archived threads are kept but stay out of the default list.
    status: query.status ?? 'active',
  };

  if (query.search) {
    filter.title = { $regex: query.search, $options: 'i' };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    ConversationModel.find(filter)
      .sort({ lastMessageAt: -1, createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<ConversationDocument[]>()
      .exec(),
    ConversationModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const renameConversation = async (
  actor: AuthenticatedUser,
  id: string,
  title: string,
): Promise<ConversationDocument> => {
  const updated = await ConversationModel.findOneAndUpdate(
    ownedBy(actor, id),
    { $set: { title: title.trim() } },
    { returnDocument: 'after' },
  )
    .lean<ConversationDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Conversation not found');
  }

  return updated;
};

export const setConversationStatus = async (
  actor: AuthenticatedUser,
  id: string,
  status: ConversationStatus,
): Promise<ConversationDocument> => {
  const updated = await ConversationModel.findOneAndUpdate(
    ownedBy(actor, id),
    { $set: { status } },
    { returnDocument: 'after' },
  )
    .lean<ConversationDocument | null>()
    .exec();

  if (!updated) {
    throw ApiError.notFound('Conversation not found');
  }

  return updated;
};

/**
 * Deletes a conversation and its messages together. Archiving is the softer
 * option and is what the UI offers first; this is for someone who genuinely
 * wants the transcript gone.
 */
export const deleteConversation = async (actor: AuthenticatedUser, id: string): Promise<void> => {
  await getConversation(actor, id);

  await runInTransaction(async (session) => {
    await MessageModel.deleteMany(
      { conversation: toObjectId(id), user: toObjectId(actor.id) },
      { session },
    ).exec();
    await ConversationModel.deleteOne(ownedBy(actor, id), { session }).exec();
  });
};

export interface AppendMessageInput {
  conversationId: string;
  role: MessageRole;
  content: string;
  toolCalls?: MessageToolCallSubdocument[];
  toolCallId?: string | null;
  model?: string | null;
  usage?: MessageDocument['usage'];
  session?: ClientSession | undefined;
}

/**
 * Adds one message and moves the conversation's own counters with it, so the
 * list ordering can never drift from the transcript.
 */
export const appendMessage = async (
  actor: AuthenticatedUser,
  input: AppendMessageInput,
): Promise<MessageDocument> => {
  const createdAt = new Date();

  const [message] = await MessageModel.create(
    [
      {
        conversation: toObjectId(input.conversationId),
        user: toObjectId(actor.id),
        role: input.role,
        content: input.content,
        toolCalls: input.toolCalls ?? [],
        toolCallId: input.toolCallId ?? null,
        model: input.model ?? null,
        usage: input.usage ?? null,
      },
    ],
    { session: input.session },
  );

  if (!message) {
    throw ApiError.internal('The message could not be stored');
  }

  await ConversationModel.updateOne(
    { _id: toObjectId(input.conversationId), user: toObjectId(actor.id) },
    { $set: { lastMessageAt: createdAt }, $inc: { messageCount: 1 } },
    { session: input.session },
  ).exec();

  return message.toObject<MessageDocument>();
};

export interface ListMessagesQuery {
  page: number;
  pageSize: number;
}

/**
 * A page of the transcript, oldest first within the page so it reads naturally,
 * while paging walks backwards from the newest message.
 */
export const listMessages = async (
  actor: AuthenticatedUser,
  conversationId: string,
  query: ListMessagesQuery,
): Promise<PaginatedResult<MessageDocument>> => {
  await getConversation(actor, conversationId);

  const filter = { conversation: toObjectId(conversationId), user: toObjectId(actor.id) };
  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    MessageModel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<MessageDocument[]>()
      .exec(),
    MessageModel.countDocuments(filter).exec(),
  ]);

  return {
    items: items.reverse(),
    pagination: buildPaginationMeta({ page, pageSize }, total),
  };
};

/**
 * The newest `limit` messages, oldest first — the shape a prompt needs.
 * Deliberately separate from `listMessages`: the context window is bounded by
 * design and must never be driven by a client's page size.
 */
export const listRecentMessages = async (
  actor: AuthenticatedUser,
  conversationId: string,
  limit: number,
): Promise<MessageDocument[]> => {
  const messages = await MessageModel.find({
    conversation: toObjectId(conversationId),
    user: toObjectId(actor.id),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean<MessageDocument[]>()
    .exec();

  return messages.reverse();
};

export const countMessages = async (
  actor: AuthenticatedUser,
  conversationId: string,
): Promise<number> =>
  MessageModel.countDocuments({
    conversation: toObjectId(conversationId),
    user: toObjectId(actor.id),
  }).exec();
