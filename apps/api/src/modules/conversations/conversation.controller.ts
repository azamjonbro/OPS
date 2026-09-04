import {
  sendCreated,
  sendNoContent,
  sendPaginated,
  sendSuccess,
} from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import * as agentService from '../ai/agent/agent.service.js';
import * as conversationService from './conversation.service.js';
import type {
  conversationIdParamSchema,
  createConversationSchema,
  listConversationsQuerySchema,
  listMessagesQuerySchema,
  sendMessageSchema,
  updateConversationSchema,
} from './conversation.validators.js';

export const create: ValidatedHandler<{ body: typeof createConversationSchema }> = async (
  req,
  res,
) => {
  const conversation = await conversationService.createConversation(
    requireActor(req),
    req.validated.body,
  );

  sendCreated(req, res, conversation);
};

export const list: ValidatedHandler<{ query: typeof listConversationsQuerySchema }> = async (
  req,
  res,
) => {
  const result = await conversationService.listConversations(
    requireActor(req),
    req.validated.query,
  );

  sendPaginated(req, res, result);
};

export const detail: ValidatedHandler<{ params: typeof conversationIdParamSchema }> = async (
  req,
  res,
) => {
  const conversation = await conversationService.getConversation(
    requireActor(req),
    req.validated.params.id,
  );

  sendSuccess(req, res, conversation);
};

export const update: ValidatedHandler<{
  params: typeof conversationIdParamSchema;
  body: typeof updateConversationSchema;
}> = async (req, res) => {
  const actor = requireActor(req);
  const { id } = req.validated.params;
  const { title, status } = req.validated.body;

  let conversation = await conversationService.getConversation(actor, id);

  if (title !== undefined) {
    conversation = await conversationService.renameConversation(actor, id, title);
  }

  if (status !== undefined) {
    conversation = await conversationService.setConversationStatus(actor, id, status);
  }

  sendSuccess(req, res, conversation);
};

export const remove: ValidatedHandler<{ params: typeof conversationIdParamSchema }> = async (
  req,
  res,
) => {
  await conversationService.deleteConversation(requireActor(req), req.validated.params.id);

  sendNoContent(res);
};

export const listMessages: ValidatedHandler<{
  params: typeof conversationIdParamSchema;
  query: typeof listMessagesQuerySchema;
}> = async (req, res) => {
  const result = await conversationService.listMessages(
    requireActor(req),
    req.validated.params.id,
    req.validated.query,
  );

  sendPaginated(req, res, result);
};

/** Sends a turn to an existing conversation and returns the assistant's reply. */
export const sendMessage: ValidatedHandler<{
  params: typeof conversationIdParamSchema;
  body: typeof sendMessageSchema;
}> = async (req, res) => {
  const result = await agentService.sendMessage(requireActor(req), {
    conversationId: req.validated.params.id,
    message: req.validated.body.message,
  });

  sendCreated(req, res, result);
};
