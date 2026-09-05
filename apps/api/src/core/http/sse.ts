import type { Request, Response } from 'express';

/**
 * A server-sent-event connection, with the details that make one actually work.
 *
 * SSE is a plain HTTP response that is never closed, which sounds simple and is
 * mostly a list of things that will silently break it:
 *
 *  - **Compression buffers.** `compression()` is mounted on every route in this
 *    application and will happily hold a stream's bytes until it has enough to
 *    be worth gzipping, which for a trickle of small events is "for ever". The
 *    `no-transform` cache directive is the documented way to tell it not to,
 *    and it is why that header is not optional here.
 *  - **Proxies buffer too.** `X-Accel-Buffering: no` is nginx's opt-out and is
 *    ignored harmlessly by everything else.
 *  - **Idle connections get reaped.** A comment line every twenty seconds keeps
 *    the socket warm without being an event a client has to understand.
 *  - **A dead client is not an error.** When somebody closes the tab the socket
 *    goes away mid-write; that is the normal end of a stream, not a failure to
 *    report.
 *
 * Nothing decides here *what* may be sent. Whatever is passed in is already
 * safe: the events come from the agent's sanitiser, which drops anything that
 * is not a name, a number or a flag.
 */

const HEARTBEAT_MS = 20_000;

export interface SseConnection {
  /** Writes one event. Named so a client can listen for a specific kind. */
  send: (event: string, data: unknown, id?: number | string) => void;
  /** Writes a comment. Invisible to `EventSource`; keeps the socket alive. */
  comment: (text: string) => void;
  /** True once the client has gone or the stream has been ended. */
  readonly closed: boolean;
  /** Runs when the client disconnects. Registering twice replaces nothing. */
  onClose: (listener: () => void) => void;
  end: () => void;
}

export const openSse = (req: Request, res: Response): SseConnection => {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  // `no-transform` is what stops the compression middleware buffering this.
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const listeners = new Set<() => void>();

  const finish = (): void => {
    if (closed) {
      return;
    }

    closed = true;
    clearInterval(heartbeat);

    for (const listener of listeners) {
      listener();
    }

    listeners.clear();
  };

  const write = (chunk: string): void => {
    if (closed || res.writableEnded) {
      return;
    }

    try {
      res.write(chunk);
    } catch {
      // The other end went away between the check and the write.
      finish();
    }
  };

  const heartbeat = setInterval(() => {
    write(': keep-alive\n\n');
  }, HEARTBEAT_MS);

  // Never hold the process open for a heartbeat; a graceful shutdown should not
  // have to wait twenty seconds per idle stream.
  heartbeat.unref?.();

  req.on('close', finish);
  res.on('close', finish);

  return {
    get closed() {
      return closed;
    },
    send: (event, data, id) => {
      const lines = [
        id === undefined ? '' : `id: ${String(id)}\n`,
        `event: ${event}\n`,
        // One `data:` line. Newlines inside JSON strings are escaped by
        // `JSON.stringify`, so the payload can never contain a raw newline and
        // split itself across two events.
        `data: ${JSON.stringify(data)}\n\n`,
      ];

      write(lines.join(''));
    },
    comment: (text) => {
      write(`: ${text.replace(/\n/g, ' ')}\n\n`);
    },
    onClose: (listener) => {
      if (closed) {
        listener();

        return;
      }

      listeners.add(listener);
    },
    end: () => {
      finish();

      if (!res.writableEnded) {
        res.end();
      }
    },
  };
};

/**
 * Reads the sequence a reconnecting client last saw.
 *
 * The browser sends `Last-Event-ID` on its own when `EventSource` reconnects;
 * a `fetch`-based client sends the same header by hand, and the query
 * parameter is the fallback for anything that cannot set headers. Anything
 * unparseable is treated as "from the beginning", which replays more than
 * necessary rather than silently skipping what was missed.
 */
export const lastEventId = (req: Request): number => {
  const header = req.get('Last-Event-ID') ?? req.get('last-event-id');
  const query = typeof req.query.lastEventId === 'string' ? req.query.lastEventId : undefined;
  const parsed = Number.parseInt(header ?? query ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
