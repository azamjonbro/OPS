import type { Request, Response } from 'express';

import { sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import type { chatSchema } from '../conversations/conversation.validators.js';
import * as agentService from './agent/agent.service.js';
import { describeAiProvider } from './provider/index.js';
import { getToolRegistry } from './tools/index.js';

/**
 * The assistant's single entry point.
 *
 * The caller sends text and, optionally, which conversation it belongs to.
 * Everything else the agent needs — who is asking, the recent turns, the
 * memories worth recalling — is assembled server-side from the authenticated
 * request, so a client can neither widen the context nor answer as someone else.
 */
export const chat: ValidatedHandler<{ body: typeof chatSchema }> = async (req, res) => {
  const result = await agentService.sendMessage(requireActor(req), {
    conversationId: req.validated.body.conversationId,
    message: req.validated.body.message,
  });

  sendSuccess(req, res, result);
};

/** What the assistant can currently do, and whether it can answer at all. */
export const status = (req: Request, res: Response): void => {
  // Reports the resolved provider and model only — never the key, and never
  // anything derived from it.
  const provider = describeAiProvider();

  sendSuccess(req, res, {
    ...provider,
    tools: getToolRegistry()
      .list()
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        mutates: tool.mutates,
        // Surfaced so a client can warn before a destructive call is proposed.
        requiresConfirmation: tool.requiresConfirmation ?? false,
      })),
  });
};
