import http from 'node:http';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { closeOpenSseConnections, openSse, openSseConnectionCount } from './sse.js';

/**
 * What an open stream does to a shutdown.
 *
 * An SSE response is a request that never finishes, and `server.close()` waits
 * for requests to finish. Left alone, a deploy performed while somebody was
 * watching an answer sat out the whole shutdown budget and was then killed —
 * which a supervisor records as a crash, and which makes every restart during
 * working hours look like a fault.
 *
 * These run a real server and a real socket rather than a mock, because the
 * behaviour under test belongs to Node's HTTP server and not to this module:
 * a test against a fake would keep passing if `close()` changed its mind.
 */
let server: http.Server | null = null;

const startServer = async (): Promise<number> => {
  const app = express();

  app.get('/stream', (req, res) => {
    const connection = openSse(req, res);

    connection.send('ready', { ok: true });
    // Deliberately never ended: this is a run being watched.
  });

  server = http.createServer(app);

  await new Promise<void>((resolve) => {
    server?.listen(0, '127.0.0.1', resolve);
  });

  return (server.address() as { port: number }).port;
};

/** Resolves once the server has finished closing, or `false` if it has not. */
const closeWithin = (ms: number): Promise<boolean> =>
  new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(false);
      }
    }, ms);

    server?.close(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(true);
      }
    });
  });

afterEach(() => {
  closeOpenSseConnections();
  server?.closeAllConnections?.();
  server = null;
});

describe('open streams and shutdown', () => {
  it('counts a stream while it is open and forgets it when the client goes', async () => {
    const port = await startServer();
    const controller = new AbortController();

    const response = await fetch(`http://127.0.0.1:${port}/stream`, {
      signal: controller.signal,
    });
    await response.body?.getReader().read();

    expect(openSseConnectionCount()).toBe(1);

    controller.abort();
    // The socket closing is what deregisters it, and that is a network event.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(openSseConnectionCount()).toBe(0);
  });

  it('ends every open stream so the server can actually close', async () => {
    const port = await startServer();

    const first = await fetch(`http://127.0.0.1:${port}/stream`);
    const second = await fetch(`http://127.0.0.1:${port}/stream`);
    await first.body?.getReader().read();
    await second.body?.getReader().read();

    expect(openSseConnectionCount()).toBe(2);
    expect(closeOpenSseConnections()).toBe(2);
    expect(openSseConnectionCount()).toBe(0);

    // The regression: without the line above this resolves `false`, the
    // shutdown manager hits its deadline, and the process is killed with a
    // non-zero code on an ordinary deploy.
    await expect(closeWithin(2_000)).resolves.toBe(true);
  });

  it('is safe to call when nothing is streaming', () => {
    expect(closeOpenSseConnections()).toBe(0);
  });
});
