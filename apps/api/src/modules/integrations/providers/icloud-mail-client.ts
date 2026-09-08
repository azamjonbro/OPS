import { connect as connectTls, type TLSSocket } from 'node:tls';

import { McpError } from '../mcp/mcp-error.js';

/**
 * Just enough IMAP to prove an iCloud mailbox is reachable.
 *
 * Deliberately not an IMAP library. What this has to do is open a TLS socket,
 * log in, ask INBOX how many messages it holds and hang up — four commands, no
 * literals, no untagged data worth parsing beyond one line. A dependency for
 * that would be more code to audit, not less, and this file can be read in full
 * by whoever needs to trust what happens to an app-specific password.
 *
 * The host is fixed rather than configurable. Nobody types an address here, so
 * there is no way to point the process at an internal service — a credential
 * check that accepted a host would be a request forgery primitive with a login
 * form attached.
 */
export const ICLOUD_IMAP_HOST = 'imap.mail.me.com';
export const ICLOUD_IMAP_PORT = 993;

export interface IcloudMailboxStatus {
  /** The address that authenticated, echoed back so a person recognises it. */
  email: string;
  /** Messages in INBOX, or null when the server did not say. */
  messages: number | null;
  /** Unread messages in INBOX, or null when the server did not say. */
  unseen: number | null;
}

/**
 * IMAP quoted strings take a backslash escape, and an app-specific password is
 * ASCII — but a person can paste anything into the field, and an unescaped
 * quote would turn the rest of the password into protocol.
 */
const quoted = (value: string): string => `"${value.replace(/[\\"]/g, '\\$&')}"`;

const readNumber = (line: string, key: string): number | null => {
  const match = new RegExp(`${key} (\\d+)`, 'i').exec(line);

  return match?.[1] === undefined ? null : Number(match[1]);
};

interface Session {
  /** Sends one tagged command and resolves with every line of its response. */
  send: (tag: string, command: string) => Promise<string[]>;
  close: () => void;
}

/** Opens the socket and resolves once the server has sent its greeting. */
const openSession = (timeoutMs: number): Promise<Session> =>
  new Promise((resolve, reject) => {
    let buffer = '';
    /** Set while a command is in flight; resolved by the tagged reply. */
    let pending: { tag: string; lines: string[]; settle: (lines: string[]) => void } | null = null;
    let greeted = false;

    const socket: TLSSocket = connectTls({
      host: ICLOUD_IMAP_HOST,
      port: ICLOUD_IMAP_PORT,
      servername: ICLOUD_IMAP_HOST,
    });

    const fail = (error: McpError): void => {
      socket.destroy();
      reject(error);
    };

    socket.setTimeout(timeoutMs, () => {
      fail(new McpError('timeout', 'iCloud did not answer in time.'));
    });

    socket.on('error', (cause) => {
      fail(new McpError('unreachable', 'iCloud’s mail server could not be reached.', { cause }));
    });

    socket.on('close', () => {
      // A socket that closes mid-command must not leave a caller waiting for a
      // reply that can no longer arrive.
      pending?.settle([`${pending.tag} NO the connection closed`]);
      pending = null;
    });

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');

      let newline = buffer.indexOf('\r\n');

      while (newline !== -1) {
        const line = buffer.slice(0, newline);

        buffer = buffer.slice(newline + 2);
        newline = buffer.indexOf('\r\n');

        if (!greeted) {
          greeted = true;

          if (!line.startsWith('* OK')) {
            fail(new McpError('protocol', 'iCloud’s mail server refused the connection.'));

            return;
          }

          resolve({
            send: (tag, command) =>
              new Promise((settle) => {
                pending = { tag, lines: [], settle };
                socket.write(`${tag} ${command}\r\n`);
              }),
            close: () => socket.destroy(),
          });

          continue;
        }

        if (!pending) {
          continue;
        }

        pending.lines.push(line);

        if (line.startsWith(`${pending.tag} `)) {
          const { lines, settle } = pending;

          pending = null;
          settle(lines);
        }
      }
    });
  });

const assertOk = (lines: string[], tag: string, whenNo: McpError): void => {
  const tagged = lines.find((line) => line.startsWith(`${tag} `)) ?? '';

  if (!/^\S+ OK/i.test(tagged)) {
    throw whenNo;
  }
};

/**
 * Logs in and reads INBOX's counts.
 *
 * This is the whole health check, and it is read-only by construction: LOGIN
 * and STATUS are the only commands sent, so pressing "check" can never mark a
 * message read, move one or send anything.
 */
export const checkIcloudMailbox = async (
  email: string,
  appPassword: string,
  timeoutMs = 15_000,
): Promise<IcloudMailboxStatus> => {
  const session = await openSession(timeoutMs);

  try {
    const login = await session.send('h1', `LOGIN ${quoted(email)} ${quoted(appPassword)}`);

    assertOk(
      login,
      'h1',
      new McpError(
        'authentication',
        'iCloud refused the Apple ID and app-specific password. Generate a new one at appleid.apple.com and paste it here.',
      ),
    );

    const status = await session.send('h2', 'STATUS "INBOX" (MESSAGES UNSEEN)');

    assertOk(status, 'h2', new McpError('protocol', 'iCloud would not report on the inbox.'));

    const line = status.find((candidate) => candidate.startsWith('* STATUS')) ?? '';

    await session.send('h3', 'LOGOUT');

    return {
      email,
      messages: readNumber(line, 'MESSAGES'),
      unseen: readNumber(line, 'UNSEEN'),
    };
  } finally {
    session.close();
  }
};
