import { randomUUID } from 'node:crypto';

import { SPEECH_DURATION_FIELD, type AgentStreamFrame } from '@hadiya/shared';
import type { Request, Response } from 'express';

import { config } from '../../config/index.js';
import { ApiError } from '../../core/http/api-error.js';
import { sendSuccess } from '../../core/http/api-response.js';
import { lastEventId, openSse } from '../../core/http/sse.js';
import { requireActor } from '../../core/security/actor.js';
import { createLogger } from '../../core/logger/logger.js';
import type { ValidatedHandler } from '../../core/middleware/validate.js';
import type { chatSchema } from '../conversations/conversation.validators.js';
import * as conversationService from '../conversations/conversation.service.js';
import * as agentService from './agent/agent.service.js';
import { cancelConversationRuns } from './agent/agent-cancellation.js';
import { onAgentEvent } from './agent/agent-events.js';
import * as runRegistry from './agent/agent-run-registry.js';
import * as pendingActionService from './agent/pending-action.service.js';
import type {
  cancelRunSchema,
  conversationParamSchema,
  chatStreamQuerySchema,
  runParamSchema,
} from './ai.validators.js';

const log = createLogger('ai-stream');
import { describeAiProvider } from './provider/index.js';
import { describeSpeechProvider } from './stt/index.js';
import * as transcriptionService from './stt/transcription.service.js';
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
/**
 * Whether this caller wants to watch the turn happen.
 *
 * Two ways to ask, and both are opt-in: a client that says nothing gets exactly
 * the JSON reply it has always got. That is what keeps the endpoint one
 * endpoint — there is no second chat API for streaming clients, only a second
 * shape for the same turn.
 */
const wantsStream = (req: Request, stream: string | undefined): boolean =>
  stream !== undefined || (req.get('accept') ?? '').includes('text/event-stream');

/**
 * Streams one turn as it happens.
 *
 * The listener is registered *before* the agent is started, on a run id chosen
 * here rather than inside. That ordering is the whole design: an agent that
 * generated its own id would have emitted `agent.started` before anything could
 * subscribe, and the first events of every run — the ones that say what the
 * assistant set off to do — would be lost to a race nobody would notice until
 * production.
 *
 * The run is not cancelled when the socket closes. A person who shuts a tab
 * mid-answer should come back to a finished conversation, not a half-written
 * one; cancelling is a thing they ask for, through the cancel endpoint, and
 * this is not that.
 */
const streamChat = async (
  req: Request,
  res: Response,
  input: { conversationId: string | undefined; message: string },
): Promise<void> => {
  const actor = requireActor(req);
  const runId = randomUUID();
  const connection = openSse(req, res);

  const write = (frame: AgentStreamFrame): void => {
    connection.send(
      frame.frame === 'event' ? frame.event.type : `stream.${frame.frame}`,
      frame,
      frame.frame === 'event' ? frame.event.sequence : undefined,
    );
  };

  const unsubscribe = onAgentEvent((event) => {
    if (event.workflowId === runId) {
      write({ frame: 'event', event });
    }
  });

  connection.onClose(() => {
    unsubscribe();
    log.debug({ user: actor.id, run: runId }, 'stream client disconnected');
  });

  write({ frame: 'ready', runId, conversationId: input.conversationId ?? '' });

  try {
    const result = await agentService.sendMessage(actor, input, {
      runId,
      requestId: req.id,
      // Somebody is watching, so the answer is worth sending as it is written.
      streamDeltas: true,
    });

    write({ frame: 'result', response: result });
  } catch (error) {
    // The same translation the JSON path performs, written into the stream
    // instead of thrown: the response has already begun, so there is no status
    // code left to set and the error handler cannot help.
    const failure =
      error instanceof ApiError
        ? { code: error.code, message: error.message }
        : { code: 'INTERNAL_ERROR', message: 'The assistant could not finish that.' };

    log.warn({ user: actor.id, run: runId, err: error }, 'streamed turn failed');
    write({ frame: 'error', ...failure });
  } finally {
    unsubscribe();
    connection.end();
  }
};

export const chat: ValidatedHandler<{
  body: typeof chatSchema;
  query: typeof chatStreamQuerySchema;
}> = async (req, res) => {
  const input = {
    conversationId: req.validated.body.conversationId,
    message: req.validated.body.message,
  };

  if (wantsStream(req, req.validated.query.stream)) {
    await streamChat(req, res, input);

    return;
  }

  const result = await agentService.sendMessage(requireActor(req), input, {
    // Ties every tool call and log line in the run back to this request.
    requestId: req.id,
  });

  sendSuccess(req, res, result);
};

/**
 * Rejoins a run that is already going.
 *
 * For the reconnection case rather than the ordinary one: a stream that dropped
 * mid-answer, or a browser that reloaded and found its way back through the
 * conversation. `Last-Event-ID` says what the client already saw, and the run's
 * buffer replays only what came after — so rejoining twice does not draw the
 * same tool twice.
 *
 * Ownership is the registry's, not this handler's: a run belongs to the account
 * that started it, and asking for somebody else's is answered as though it did
 * not exist.
 */
export const streamRun: ValidatedHandler<{ params: typeof runParamSchema }> = async (req, res) => {
  const actor = requireActor(req);
  const { runId } = req.validated.params;
  const connection = openSse(req, res);

  const write = (frame: AgentStreamFrame): void => {
    connection.send(
      frame.frame === 'event' ? frame.event.type : `stream.${frame.frame}`,
      frame,
      frame.frame === 'event' ? frame.event.sequence : undefined,
    );
  };

  let subscription: runRegistry.Subscription;

  try {
    subscription = runRegistry.subscribeToRun({
      runId,
      userId: actor.id,
      afterSequence: lastEventId(req),
      onFrame: write,
    });
  } catch (error) {
    // The stream is already open, so the refusal is written into it rather
    // than thrown. It says the run is unavailable and nothing about whether it
    // exists, which is all a stranger is owed.
    write({
      frame: 'error',
      code: error instanceof ApiError ? error.code : 'NOT_FOUND',
      message: 'That run is not available.',
    });
    connection.end();

    return;
  }

  connection.onClose(subscription.unsubscribe);

  write({ frame: 'ready', runId, conversationId: '' });

  for (const frame of subscription.replay) {
    write(frame);
  }

  if (subscription.finished) {
    connection.end();
  }
};

/** Everything known about one run, for a browser that has just reloaded. */
export const runState: ValidatedHandler<{ params: typeof runParamSchema }> = (req, res) => {
  sendSuccess(req, res, runRegistry.runSnapshot(req.validated.params.runId, requireActor(req).id));
};

/**
 * The newest run in a conversation, or `null`.
 *
 * How a reloaded browser finds a turn that is still going: it has the
 * conversation from the URL and nothing else. `null` is an ordinary answer —
 * the run finished and was swept, or is on another instance — and means there
 * is nothing live to watch rather than that something went wrong.
 */
export const conversationRun: ValidatedHandler<{ params: typeof conversationParamSchema }> = async (
  req,
  res,
) => {
  const actor = requireActor(req);
  const { conversationId } = req.validated.params;

  await conversationService.getConversation(actor, conversationId);

  sendSuccess(req, res, {
    run: runRegistry.latestRunForConversation(actor.id, conversationId),
  });
};

/**
 * Stops a run this person has going, and withdraws anything it had prepared.
 *
 * Deliberately not a second way to talk to the assistant: it starts nothing,
 * sends nothing to a model and returns no reply. What it does is abort the
 * in-flight run and cancel every proposal in that conversation, so a
 * destructive call that was waiting to be agreed to can never be agreed to
 * afterwards. The conversation is fetched first, which is what makes this the
 * caller's own run and not somebody else's.
 */
export const cancel: ValidatedHandler<{ body: typeof cancelRunSchema }> = async (req, res) => {
  const actor = requireActor(req);
  const { conversationId } = req.validated.body;

  await conversationService.getConversation(actor, conversationId);

  const cancelledRuns = cancelConversationRuns(actor.id, conversationId);
  const cancelledActions = await pendingActionService.cancelPendingActions(actor, conversationId);

  sendSuccess(req, res, { conversationId, cancelledRuns, cancelledActions });
};

/** What this conversation is waiting on the person to agree to. */
export const pendingActions: ValidatedHandler<{ params: typeof conversationParamSchema }> = async (
  req,
  res,
) => {
  const actor = requireActor(req);
  const { conversationId } = req.validated.params;

  await conversationService.getConversation(actor, conversationId);

  const actions = await pendingActionService.listPendingActions(actor, conversationId);

  sendSuccess(req, res, { items: actions.map(pendingActionService.toPendingActionSummary) });
};

/** What the assistant can currently do, and whether it can answer at all. */
export const status = (req: Request, res: Response): void => {
  // Reports the resolved provider and model only — never the key, and never
  // anything derived from it.
  const provider = describeAiProvider();

  sendSuccess(req, res, {
    ...provider,
    // The budget a run is held to, so a client can explain why a long workflow
    // stopped where it did. Numbers only; nothing here is a credential.
    limits: {
      maxToolRounds: config.agent.maxToolRounds,
      maxModelCalls: config.agent.maxModelCalls,
      maxParallelTools: config.agent.maxParallelTools,
      toolTimeoutMs: config.agent.toolTimeoutMs,
      maxToolRetries: config.agent.maxToolRetries,
      confirmationTtlMs: config.agent.confirmationTtlMs,
    },
    // The built-in tools only. What a person has connected is theirs, and this
    // endpoint answers the same for everybody: listing one account's MCP
    // servers here would be the cross-tenant leak the per-actor registry
    // exists to prevent.
    tools: getToolRegistry().describe(),
  });
};

/**
 * How long the browser says the recording is.
 *
 * A text field beside the audio, so it arrives as a string that could be
 * anything. Anything unreadable is treated as "not said" rather than as an
 * error: the figure is a courtesy that saves a pointless minute of
 * transcription, and a client that omits it is not doing anything wrong.
 */
const readDeclaredDuration = (req: Request): number | null => {
  const raw = (req.body as Record<string, unknown> | undefined)?.[SPEECH_DURATION_FIELD];
  const parsed = Number.parseInt(typeof raw === 'string' ? raw : '', 10);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

/**
 * Turns a recording into text, and nothing else.
 *
 * It deliberately does *not* answer the question the person asked: the
 * transcript goes back to the composer so they can read it, fix a misheard word
 * and decide whether to send it. Wiring this straight into the agent would mean
 * a mis-transcription became a message nobody chose to send, and on a shop floor
 * that is how the wrong thing gets ordered.
 *
 * The audio is read from memory and released with the request; nothing is
 * written to disk and nothing is kept.
 */
export const transcribe = async (req: Request, res: Response): Promise<void> => {
  const file = req.file;

  if (!file) {
    throw ApiError.badRequest('No recording was attached.');
  }

  const result = await transcriptionService.transcribe(requireActor(req), {
    audio: file.buffer,
    // The declared content type, not the filename: a name from the browser is
    // untrusted text and has no bearing on what the bytes are.
    mimeType: file.mimetype,
    declaredDurationMs: readDeclaredDuration(req),
    languages: config.speech.languages,
    requestId: req.id,
  });

  sendSuccess(req, res, result);
};

/** Whether voice input can be offered at all. Holds no credential. */
export const speechStatus = (req: Request, res: Response): void => {
  sendSuccess(req, res, describeSpeechProvider());
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
