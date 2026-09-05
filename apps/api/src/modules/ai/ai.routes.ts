import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { uploadAudio } from '../../core/http/upload.js';
import { validated } from '../../core/middleware/validate.js';
import { chatSchema } from '../conversations/conversation.validators.js';
import * as aiController from './ai.controller.js';
import { cancelRunSchema, conversationParamSchema } from './ai.validators.js';

export const aiRouter: Router = Router();

aiRouter.post('/chat', ...validated({ body: chatSchema }, aiController.chat));

/**
 * Stopping a run, and seeing what one is waiting for.
 *
 * Both hang off `/chat` rather than opening a parallel conversation API,
 * because they are operations on a turn that `/chat` started. Neither sends
 * anything to a model: `cancel` aborts and withdraws, `pending-actions` reads.
 */
aiRouter.post('/chat/cancel', ...validated({ body: cancelRunSchema }, aiController.cancel));
aiRouter.get(
  '/chat/:conversationId/pending-actions',
  ...validated({ params: conversationParamSchema }, aiController.pendingActions),
);
aiRouter.get('/status', aiController.status);
aiRouter.get('/usage', asyncHandler(aiController.usage));

/**
 * Dictation. Extends the assistant's own router rather than opening a second
 * one: it is the same capability from the same account, and it inherits the
 * authentication the whole `/v1` tree is mounted behind.
 *
 * The transcript is returned to the caller and goes nowhere near the agent —
 * sending is a decision the person makes afterwards, in the composer.
 */
aiRouter.post('/transcribe', uploadAudio(), asyncHandler(aiController.transcribe));
aiRouter.get('/speech-status', aiController.speechStatus);
