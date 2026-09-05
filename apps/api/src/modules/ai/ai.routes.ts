import { Router } from 'express';

import { asyncHandler } from '../../core/http/async-handler.js';
import { uploadAudio } from '../../core/http/upload.js';
import { validated } from '../../core/middleware/validate.js';
import { chatSchema } from '../conversations/conversation.validators.js';
import * as aiController from './ai.controller.js';
import {
  cancelRunSchema,
  chatStreamQuerySchema,
  conversationParamSchema,
  runParamSchema,
} from './ai.validators.js';

export const aiRouter: Router = Router();

/**
 * The assistant, in one endpoint.
 *
 * `?stream=1` or `Accept: text/event-stream` asks for the turn as it happens;
 * anything else gets the JSON reply it always did. Same handler, same agent,
 * same run — a second endpoint would have meant a second execution path, and
 * two paths through an agent is how the streaming one quietly stops matching
 * the one that is tested.
 */
aiRouter.post(
  '/chat',
  ...validated({ body: chatSchema, query: chatStreamQuerySchema }, aiController.chat),
);

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
/**
 * Watching a run that is already going.
 *
 * `stream` is the reconnection path — a socket that dropped, or a browser that
 * reloaded — and replays from `Last-Event-ID` so nothing is drawn twice. The
 * other two are reads: one run by id, and the newest run in a conversation,
 * which is how a reloaded browser finds its way back to a turn in progress.
 */
aiRouter.get(
  '/runs/:runId/stream',
  ...validated({ params: runParamSchema }, aiController.streamRun),
);
aiRouter.get('/runs/:runId', ...validated({ params: runParamSchema }, aiController.runState));
aiRouter.get(
  '/chat/:conversationId/run',
  ...validated({ params: conversationParamSchema }, aiController.conversationRun),
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
