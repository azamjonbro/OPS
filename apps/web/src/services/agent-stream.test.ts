import type { AgentEvent, AgentStreamFrame, ChatResponse } from '@hadiya/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  streamChat,
  watchRun,
  StreamUnavailableError,
  type AgentStreamHandlers,
} from '@/services/agent-stream';
import { makeChatResponse, makeToolEvent, resetAgentEventSequence } from '@/test/factories';
import { tokenStorage } from '@/services/token-storage';

/**
 * Reading the stream.
 *
 * `fetch` is scripted rather than reached: the point of these is what the
 * client does with a body, not whether a server can produce one. That includes
 * the awkward cases a real network produces and a happy-path test never does —
 * a frame split across two chunks, a connection that ends mid-run, a
 * reconnection that must not draw the same step twice.
 */

/** One SSE frame, written the way the server writes it. */
const frame = (payload: AgentStreamFrame, id?: number): string =>
  `${id === undefined ? '' : `id: ${String(id)}\n`}event: ${
    payload.frame === 'event' ? payload.event.type : `stream.${payload.frame}`
  }\ndata: ${JSON.stringify(payload)}\n\n`;

/** A response whose body delivers `chunks` in order. */
const sseResponse = (chunks: string[], status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();

        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }

        controller.close();
      },
    }),
    text: () => Promise.resolve(''),
  }) as unknown as Response;

const collect = (): {
  handlers: AgentStreamHandlers;
  events: AgentEvent[];
  results: ChatResponse[];
  failures: Error[];
  reconnects: number[];
} => {
  const events: AgentEvent[] = [];
  const results: ChatResponse[] = [];
  const failures: Error[] = [];
  const reconnects: number[] = [];

  return {
    events,
    results,
    failures,
    reconnects,
    handlers: {
      onEvent: (event) => events.push(event),
      onResult: (response) => results.push(response),
      onFailure: (error) => failures.push(error),
      onReconnecting: (attempt) => reconnects.push(attempt),
    },
  };
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetAgentEventSequence();
  tokenStorage.write({
    accessToken: 'access-token',
    refreshToken: 'refresh-token',
    expiresIn: 900,
  });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  tokenStorage.clear();
});

describe('starting a turn', () => {
  it('reads the frames of a finished run in order', async () => {
    const response = makeChatResponse();
    const started = makeToolEvent('tool.started');
    const completed = makeToolEvent('tool.completed');

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame({ frame: 'ready', runId: 'run-1', conversationId: 'c-1' }),
        frame({ frame: 'event', event: started }, started.sequence),
        frame({ frame: 'event', event: completed }, completed.sequence),
        frame({ frame: 'result', response }),
      ]),
    );

    const sink = collect();
    const ready: string[] = [];

    await streamChat(
      { message: 'Savdo?' },
      { ...sink.handlers, onReady: (i) => ready.push(i.runId) },
    );

    expect(ready).toEqual(['run-1']);
    expect(sink.events.map((event) => event.type)).toEqual(['tool.started', 'tool.completed']);
    expect(sink.results).toEqual([response]);
    expect(sink.failures).toEqual([]);
  });

  it('carries the token in a header rather than in the URL', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([frame({ frame: 'result', response: makeChatResponse() })]),
    );

    await streamChat({ message: 'Savdo?' }, collect().handlers);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer access-token');
    // A token in a query string ends up in history, in proxy logs and in
    // referrers, which is why this transport is not `EventSource`.
    expect(url).not.toContain('access-token');
  });

  it('reassembles a frame that was split across two chunks', async () => {
    const event = makeToolEvent('tool.started');
    const whole = frame({ frame: 'event', event }, event.sequence);

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        whole.slice(0, 24),
        whole.slice(24),
        frame({ frame: 'result', response: makeChatResponse() }),
      ]),
    );

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers);

    expect(sink.events).toHaveLength(1);
    expect(sink.results).toHaveLength(1);
  });

  it('ignores a frame it cannot read rather than losing the run', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        'event: tool.started\ndata: {not json\n\n',
        frame({ frame: 'result', response: makeChatResponse() }),
      ]),
    );

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers);

    expect(sink.events).toEqual([]);
    expect(sink.results).toHaveLength(1);
  });

  it('reports a run the server said had failed', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame({ frame: 'ready', runId: 'run-1', conversationId: 'c-1' }),
        frame({
          frame: 'error',
          code: 'DEPENDENCY_UNAVAILABLE',
          message: 'The model is unavailable.',
        }),
      ]),
    );

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers);

    expect(sink.failures[0]?.message).toBe('The model is unavailable.');
    // The run failed; the stream did not. Re-sending would be wrong.
    expect(sink.failures[0]).not.toBeInstanceOf(StreamUnavailableError);
  });

  it('says the stream never opened, so a caller may safely try another way', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers);

    expect(sink.failures[0]).toBeInstanceOf(StreamUnavailableError);
  });

  it('does not offer a safe retry once the turn has started', async () => {
    // The body ends after `ready` with no terminal frame and no run to rejoin
    // by: the turn is running somewhere, and re-sending it would ask for the
    // same work twice.
    fetchMock.mockResolvedValue(sseResponse([]));

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers);

    expect(sink.failures[0]).toBeInstanceOf(Error);
    expect(sink.failures[0]).not.toBeInstanceOf(StreamUnavailableError);
  });
});

describe('rejoining a dropped stream', () => {
  it('asks only for what it has not already seen', async () => {
    const first = makeToolEvent('tool.started');
    const second = makeToolEvent('tool.completed');
    const response = makeChatResponse();

    fetchMock
      // The first connection delivers two frames and then ends without a
      // terminal frame: the connection went, not the run.
      .mockResolvedValueOnce(
        sseResponse([
          frame({ frame: 'ready', runId: 'run-1', conversationId: 'c-1' }),
          frame({ frame: 'event', event: first }, first.sequence),
        ]),
      )
      .mockResolvedValueOnce(
        sseResponse([
          frame({ frame: 'ready', runId: 'run-1', conversationId: 'c-1' }),
          frame({ frame: 'event', event: second }, second.sequence),
          frame({ frame: 'result', response }),
        ]),
      );

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers);

    expect(sink.reconnects).toEqual([1]);
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/v1/ai/runs/run-1/stream');
    expect(
      (fetchMock.mock.calls[1]?.[1] as RequestInit).headers as Record<string, string>,
    ).toMatchObject({ 'Last-Event-ID': String(first.sequence) });

    // Each step arrives once, however many connections it took.
    expect(sink.events.map((event) => event.sequence)).toEqual([first.sequence, second.sequence]);
    expect(sink.results).toEqual([response]);
  });

  it('picks up a run this browser did not start', async () => {
    const event = makeToolEvent('tool.completed');
    const response = makeChatResponse();

    fetchMock.mockResolvedValueOnce(
      sseResponse([
        frame({ frame: 'event', event }, event.sequence),
        frame({ frame: 'result', response }),
      ]),
    );

    const sink = collect();
    await watchRun('run-9', sink.handlers, { afterSequence: 3 });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('/v1/ai/runs/run-9/stream');
    expect((init.headers as Record<string, string>)['Last-Event-ID']).toBe('3');
    expect(sink.results).toEqual([response]);
  });

  it('stops when the caller loses interest', async () => {
    const controller = new AbortController();
    controller.abort();
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const sink = collect();
    await streamChat({ message: 'Savdo?' }, sink.handlers, { signal: controller.signal });

    // An abandoned stream is not a failure worth showing anybody.
    expect(sink.failures).toEqual([]);
  });
});
