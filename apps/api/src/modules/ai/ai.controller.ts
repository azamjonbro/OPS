import type { Request, Response } from 'express';

import { sendSuccess } from '../../core/http/api-response.js';
import { requireActor } from '../../core/security/actor.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import type { chatSchema } from '../conversations/conversation.validators.js';
import * as agentService from './agent/agent.service.js';
import { describeAiProvider } from './provider/index.js';
import * as usageService from './usage.service.js';
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

/**
 * What the assistant has cost so far, from Hadiya's own records.
 *
 * Not the provider's balance — that is not readable with an ordinary API key,
 * by the provider's own design — so this reports what was actually spent
 * through this application rather than guessing at what is left.
 */
export const usage = async (req: Request, res: Response): Promise<void> => {
  sendSuccess(req, res, await usageService.getUsage(requireActor(req)));
};
