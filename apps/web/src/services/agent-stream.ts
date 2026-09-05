import {
  API_ERROR_CODES,
  type AgentEvent,
  type AgentStreamFrame,
  type ApiErrorCode,
  type ChatRequest,
  type ChatResponse,
} from '@hadiya/shared';

import { appConfig } from '@/config/env';
import { ApiClientError } from './api-error';
import { refreshSession } from './http';
import { tokenStorage } from './token-storage';

/**
 * Watching a turn happen.
 *
 * Deliberately not `EventSource`, which is the obvious choice and the wrong
 * one for two reasons: it cannot send a body, so it could not start a turn, and
 * it cannot set an `Authorization` header, so the access token would have to go
 * in the query string — into browser history, into any proxy log, into the
 * referrer. `fetch` with a readable body does both properly, at the cost of the
 * reconnection `EventSource` gives away, which is written out below.
 *
 * The rest of the application talks to the API through axios and will go on
 * doing so; a browser cannot stream an XHR response body, which is the whole
 * reason this file exists beside it rather than inside it.
 */

/** How many times a dropped stream is rejoined before giving up. */
const MAX_RECONNECT_ATTEMPTS = 4;
const RECONNECT_BASE_MS = 400;

export interface AgentStreamHandlers {
  /** The run has an id. Fires before anything else, and again on a rejoin. */
  onReady?: (info: { runId: string; conversationId: string }) => void;
  onEvent: (event: AgentEvent) => void;
  /** The finished turn: the same object a non-streaming caller receives. */
  onResult: (response: ChatResponse) => void;
  onFailure: (error: ApiClientError) => void;
  /** The connection dropped and is being rejoined. Not a failure yet. */
  onReconnecting?: (attempt: number) => void;
}

interface StreamOutcome {
  /** The last event id seen, so a rejoin can ask for only what came after. */
  lastSequence: number;
  /** True once the run has finished one way or another. */
  settled: boolean;
  runId: string | null;
  /** True once any frame at all has arrived. */
  established: boolean;
}

/**
 * The stream never opened, so the turn never started.
 *
 * Worth its own type because it is the one failure a caller may safely answer
 * by sending the turn again over an ordinary request: nothing reached the
 * agent, so nothing can be duplicated. A stream that dropped *after* frames
 * arrived is not this — the turn is running, and re-sending it would ask for
 * the same work twice, which is two content plans and two invoices.
 */
export class StreamUnavailableError extends ApiClientError {
  constructor(message: string) {
    super(message, { code: 'NETWORK_ERROR' });
    this.name = 'StreamUnavailableError';
  }
}

/** The server's code, when it is one this client knows. */
const toErrorCode = (value: string): ApiErrorCode =>
  (API_ERROR_CODES as readonly string[]).includes(value)
    ? (value as ApiErrorCode)
    : 'INTERNAL_ERROR';

const authHeaders = (): Record<string, string> => {
  const tokens = tokenStorage.read();

  return tokens ? { Authorization: `Bearer ${tokens.accessToken}` } : {};
};

/**
 * Reads one SSE body, calling back as frames arrive.
 *
 * Frames are separated by a blank line and a partial one stays in the buffer
 * until the rest of it arrives — a chunk boundary falls wherever the network
 * decides, and parsing per chunk rather than per frame is the classic way to
 * lose half an event.
 */
const readFrames = async (
  response: Response,
  onFrame: (frame: AgentStreamFrame, id: number | null) => void,
  signal?: AbortSignal,
): Promise<void> => {
  if (!response.body) {
    throw new ApiClientError('The assistant stream could not be read.', { code: 'NETWORK_ERROR' });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const abort = (): void => {
    void reader.cancel().catch(() => undefined);
  };

  signal?.addEventListener('abort', abort, { once: true });

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        return;
      }

      buffer += decoder.decode(value, { stream: true });

      let boundary = buffer.indexOf('\n\n');

      while (boundary !== -1) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');

        let id: number | null = null;
        let data = '';

        for (const line of block.split('\n')) {
          if (line.startsWith('id:')) {
            const parsed = Number.parseInt(line.slice(3).trim(), 10);
            id = Number.isFinite(parsed) ? parsed : null;
          } else if (line.startsWith('data:')) {
            data += line.slice(5).trim();
          }
          // `event:` is not read: the frame's own `frame` field says what it is,
          // and trusting one source rather than two removes a way to disagree.
        }

        if (data.length === 0) {
          continue;
        }

        try {
          onFrame(JSON.parse(data) as AgentStreamFrame, id);
        } catch {
          // A frame that is not JSON is a frame this build cannot read.
          // Dropping it loses a step from the timeline, never the answer.
        }
      }
    }
  } finally {
    signal?.removeEventListener('abort', abort);
  }
};

/** Dispatches one frame to the handlers and reports whether the run is over. */
const applyFrame = (
  frame: AgentStreamFrame,
  handlers: AgentStreamHandlers,
  outcome: StreamOutcome,
): void => {
  outcome.established = true;

  switch (frame.frame) {
    case 'ready':
      outcome.runId = frame.runId;
      handlers.onReady?.({ runId: frame.runId, conversationId: frame.conversationId });

      return;

    case 'event':
      // Recorded before the handler runs, so a handler that throws still leaves
      // the resume point correct rather than replaying the event that broke it.
      outcome.lastSequence = Math.max(outcome.lastSequence, frame.event.sequence);
      handlers.onEvent(frame.event);

      return;

    case 'result':
      outcome.settled = true;
      handlers.onResult(frame.response);

      return;

    case 'error':
      outcome.settled = true;
      handlers.onFailure(new ApiClientError(frame.message, { code: toErrorCode(frame.code) }));
  }
};

const openStream = async (
  path: string,
  init: RequestInit,
  signal: AbortSignal | undefined,
): Promise<Response> => {
  const url = `${appConfig.apiBaseUrl}${path}`;
  const send = (): Promise<Response> =>
    fetch(url, {
      ...init,
      headers: { Accept: 'text/event-stream', ...authHeaders(), ...(init.headers ?? {}) },
      ...(signal ? { signal } : {}),
    });

  let response = await send();

  // The token expired between opening the composer and pressing send. One
  // refresh, shared with every other request in flight, then one retry.
  if (response.status === 401) {
    const tokens = await refreshSession();

    if (tokens) {
      response = await send();
    }
  }

  if (!response.ok) {
    throw new ApiClientError(
      response.status === 401
        ? 'Your session has expired. Sign in again.'
        : 'The assistant could not be reached.',
      {
        code: response.status === 401 ? 'UNAUTHENTICATED' : 'NETWORK_ERROR',
        status: response.status,
      },
    );
  }

  return response;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Starts a turn and watches it.
 *
 * If the connection drops before the run has finished, it rejoins by run id
 * from the last event it saw. That is what `Last-Event-ID` is for and why every
 * event carries a sequence: the server replays only what came after, so
 * rejoining does not draw a completed step a second time.
 *
 * Resolves when the run has settled or when rejoining has been given up on. It
 * does not throw for a failed run — that arrives through `onFailure`, because a
 * turn that failed is still a turn that happened and the caller has a timeline
 * to finish rendering.
 */
export const streamChat = async (
  input: ChatRequest,
  handlers: AgentStreamHandlers,
  options: { signal?: AbortSignal } = {},
): Promise<void> => {
  const outcome: StreamOutcome = {
    lastSequence: 0,
    settled: false,
    runId: null,
    established: false,
  };

  const consume = (response: Response): Promise<void> =>
    readFrames(response, (frame) => applyFrame(frame, handlers, outcome), options.signal);

  try {
    const response = await openStream(
      '/v1/ai/chat?stream=1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      },
      options.signal,
    );

    await consume(response);
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }

    // Nothing arrived, so nothing started: the caller may safely try again by
    // another route. Anything else is reported as it came.
    const message =
      error instanceof ApiClientError ? error.message : 'The assistant could not be reached.';

    handlers.onFailure(
      outcome.established
        ? error instanceof ApiClientError
          ? error
          : new ApiClientError(message, { code: 'NETWORK_ERROR' })
        : new StreamUnavailableError(message),
    );

    return;
  }

  // The body ended without a terminal frame, which means the connection went
  // rather than the run. Rejoin it.
  for (
    let attempt = 1;
    !outcome.settled && outcome.runId && attempt <= MAX_RECONNECT_ATTEMPTS;
    attempt += 1
  ) {
    if (options.signal?.aborted) {
      return;
    }

    handlers.onReconnecting?.(attempt);
    await wait(RECONNECT_BASE_MS * 2 ** (attempt - 1));

    try {
      const response = await openStream(
        `/v1/ai/runs/${outcome.runId}/stream`,
        { method: 'GET', headers: { 'Last-Event-ID': String(outcome.lastSequence) } },
        options.signal,
      );

      await consume(response);
    } catch {
      // Keep trying until the budget is spent; the loop's own condition ends it.
    }
  }

  if (!outcome.settled && !options.signal?.aborted) {
    handlers.onFailure(
      new ApiClientError('The connection to the assistant was lost.', { code: 'NETWORK_ERROR' }),
    );
  }
};

/**
 * Rejoins a run this browser was already watching.
 *
 * The reload case: the page came back, found the run through the conversation,
 * and wants the rest of it. Same handlers, same de-duplication, and the same
 * terminal frames — from the client's point of view there is no difference
 * between a run it started and one it inherited.
 */
export const watchRun = async (
  runId: string,
  handlers: AgentStreamHandlers,
  options: { signal?: AbortSignal; afterSequence?: number } = {},
): Promise<void> => {
  const outcome: StreamOutcome = {
    lastSequence: options.afterSequence ?? 0,
    settled: false,
    runId,
    established: false,
  };

  try {
    const response = await openStream(
      `/v1/ai/runs/${runId}/stream`,
      { method: 'GET', headers: { 'Last-Event-ID': String(outcome.lastSequence) } },
      options.signal,
    );

    await readFrames(response, (frame) => applyFrame(frame, handlers, outcome), options.signal);
  } catch (error) {
    if (options.signal?.aborted) {
      return;
    }

    handlers.onFailure(
      error instanceof ApiClientError
        ? error
        : new ApiClientError('The assistant could not be reached.', { code: 'NETWORK_ERROR' }),
    );
  }
};
