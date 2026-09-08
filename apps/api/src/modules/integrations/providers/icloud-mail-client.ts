import { connect as connectTls, type TLSSocket } from 'node:tls';

import { McpError } from '../mcp/mcp-error.js';
import { sanitiseExternalText } from '../mcp/mcp-tool-schema.js';

/**
 * Just enough IMAP to read an iCloud mailbox, and nothing that can change one.
 *
 * Deliberately not an IMAP library. What this has to do is open a TLS socket,
 * log in, ask a few questions and hang up; a dependency for that would be more
 * code to audit, not less, and this file can be read in full by whoever needs
 * to trust what happens to an app-specific password.
 *
 * Every command sent from here is a read: LOGIN, STATUS, EXAMINE, UID SEARCH,
 * UID FETCH with `BODY.PEEK`, LOGOUT. `EXAMINE` opens a mailbox read-only where
 * `SELECT` would open it for writing, and `PEEK` is the form of FETCH that does
 * not set `\Seen` — so reading a message here never marks it read in the
 * person's own mail app, and nothing in this file can send, move or delete.
 *
 * The host is fixed rather than configurable. Nobody types an address here, so
 * there is no way to point the process at an internal service — a credential
 * check that accepted a host would be a request forgery primitive with a login
 * form attached.
 */
export const ICLOUD_IMAP_HOST = 'imap.mail.me.com';
export const ICLOUD_IMAP_PORT = 993;

/** How much of one message is fetched, before decoding. */
const MAX_MESSAGE_BYTES = 128_000;

export interface IcloudMailboxStatus {
  /** The address that authenticated, echoed back so a person recognises it. */
  email: string;
  /** Messages in INBOX, or null when the server did not say. */
  messages: number | null;
  /** Unread messages in INBOX, or null when the server did not say. */
  unseen: number | null;
}

export interface IcloudMailHeader {
  /** The message's UID, stable for as long as the mailbox is not recreated. */
  uid: number;
  from: string;
  to: string;
  subject: string;
  date: string;
}

export interface IcloudMailMessage extends IcloudMailHeader {
  /** The plain-text body, decoded, sanitised and truncated. */
  text: string;
  /** True when the body was cut short at the caller's limit. */
  truncated: boolean;
}

export interface IcloudMailSearch {
  from?: string | undefined;
  to?: string | undefined;
  subject?: string | undefined;
  /** Matches headers and body — IMAP's own TEXT criterion. */
  text?: string | undefined;
  /** `YYYY-MM-DD`, inclusive. */
  since?: string | undefined;
  /** `YYYY-MM-DD`, exclusive, as IMAP defines BEFORE. */
  before?: string | undefined;
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

/**
 * One command's reply, with its literals lifted out.
 *
 * IMAP sends anything that cannot be quoted — a header block, a message body —
 * as `{n}` followed by exactly n bytes, which may contain CRLF and may begin
 * with something that looks like a tagged completion. Reading those by length
 * rather than by line is the only way to stay in sync with the protocol, so the
 * reader does it and hands the payloads over separately, in the order they
 * arrived. Everything else stays a line, and no parser downstream has to know
 * literals exist.
 */
interface ImapReply {
  lines: string[];
  literals: string[];
}

interface Session {
  /** Sends one tagged command and resolves with its whole reply. */
  send: (tag: string, command: string) => Promise<ImapReply>;
  /**
   * Sends a command whose argument is a literal, for text IMAP cannot quote.
   *
   * A non-ASCII search term has to travel this way: the client announces the
   * byte count, the server answers `+`, and only then do the bytes go. Without
   * it a search for a Cyrillic or Uzbek word is a syntax error.
   */
  sendWithLiteral: (tag: string, before: string, literal: string, after: string) => Promise<ImapReply>;
  close: () => void;
}

/** Opens the socket and resolves once the server has sent its greeting. */
const openSession = (timeoutMs: number): Promise<Session> =>
  new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    let greeted = false;

    /** Bytes still owed to the literal currently being read. */
    let literalRemaining = 0;
    let literalChunks: Buffer[] = [];

    interface Pending {
      tag: string;
      lines: string[];
      literals: string[];
      settle: (reply: ImapReply) => void;
      /** Set while a command is waiting for the server's `+` continuation. */
      onContinuation?: (() => void) | undefined;
    }

    let pending: Pending | null = null;

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
      if (pending) {
        const { tag, settle } = pending;

        pending = null;
        settle({ lines: [`${tag} NO the connection closed`], literals: [] });
      }
    });

    socket.on('data', (chunk) => {
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

      for (;;) {
        if (literalRemaining > 0) {
          if (buffer.length === 0) {
            return;
          }

          const take = Math.min(buffer.length, literalRemaining);

          literalChunks.push(buffer.subarray(0, take));
          buffer = buffer.subarray(take);
          literalRemaining -= take;

          if (literalRemaining === 0) {
            pending?.literals.push(Buffer.concat(literalChunks).toString('utf8'));
            literalChunks = [];
          }

          continue;
        }

        const newline = buffer.indexOf('\r\n');

        if (newline === -1) {
          return;
        }

        const line = buffer.subarray(0, newline).toString('utf8');

        buffer = buffer.subarray(newline + 2);

        if (!greeted) {
          greeted = true;

          if (!line.startsWith('* OK')) {
            fail(new McpError('protocol', 'iCloud’s mail server refused the connection.'));

            return;
          }

          const start = (tag: string): Pending => {
            const created: Pending = { tag, lines: [], literals: [], settle: () => {} };

            return created;
          };

          resolve({
            send: (tag, command) =>
              new Promise((settle) => {
                const next = start(tag);

                next.settle = settle;
                pending = next;
                socket.write(`${tag} ${command}\r\n`);
              }),
            sendWithLiteral: (tag, before, literal, after) =>
              new Promise((settle) => {
                const payload = Buffer.from(literal, 'utf8');
                const next = start(tag);

                next.settle = settle;
                next.onContinuation = () => {
                  socket.write(payload);
                  socket.write(`${after}\r\n`);
                };
                pending = next;
                socket.write(`${tag} ${before}{${payload.length}}\r\n`);
              }),
            close: () => socket.destroy(),
          });

          continue;
        }

        if (!pending) {
          continue;
        }

        // A continuation is the server's permission to send the literal it was
        // promised; it is protocol, not part of the reply.
        if (line.startsWith('+')) {
          const resume = pending.onContinuation;

          pending.onContinuation = undefined;
          resume?.();

          continue;
        }

        pending.lines.push(line);

        const literal = /\{(\d+)\}$/.exec(line);

        if (literal?.[1] !== undefined) {
          literalRemaining = Number(literal[1]);
          literalChunks = [];

          continue;
        }

        if (line.startsWith(`${pending.tag} `)) {
          const { lines, literals, settle } = pending;

          pending = null;
          settle({ lines, literals });
        }
      }
    });
  });

const assertOk = (reply: ImapReply, tag: string, whenNo: McpError): void => {
  const tagged = reply.lines.find((line) => line.startsWith(`${tag} `)) ?? '';

  if (!/^\S+ OK/i.test(tagged)) {
    throw whenNo;
  }
};

const AUTH_FAILED = (): McpError =>
  new McpError(
    'authentication',
    'iCloud refused the Apple ID and app-specific password. Generate a new one at appleid.apple.com and paste it here.',
  );

/** Logs in, and leaves the session ready for whatever the caller asked for. */
const login = async (session: Session, email: string, appPassword: string): Promise<void> => {
  const reply = await session.send('h1', `LOGIN ${quoted(email)} ${quoted(appPassword)}`);

  assertOk(reply, 'h1', AUTH_FAILED());
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
    await login(session, email, appPassword);

    const status = await session.send('h2', 'STATUS "INBOX" (MESSAGES UNSEEN)');

    assertOk(status, 'h2', new McpError('protocol', 'iCloud would not report on the inbox.'));

    const line = status.lines.find((candidate) => candidate.startsWith('* STATUS')) ?? '';

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

/* -------------------------------------------------------------------------- */
/* MIME, in the subset a mailbox actually uses                                */
/* -------------------------------------------------------------------------- */

const CHARSETS: Record<string, BufferEncoding> = {
  'utf-8': 'utf8',
  utf8: 'utf8',
  'us-ascii': 'ascii',
  ascii: 'ascii',
  'iso-8859-1': 'latin1',
  'windows-1252': 'latin1',
  latin1: 'latin1',
};

const encodingFor = (charset: string | undefined): BufferEncoding =>
  CHARSETS[(charset ?? '').trim().toLowerCase()] ?? 'utf8';

const decodeQuotedPrintable = (value: string): Buffer => {
  const joined = value.replace(/=\r?\n/g, '');
  const bytes: number[] = [];

  for (let index = 0; index < joined.length; index += 1) {
    const character = joined[index] ?? '';

    if (character === '=' && index + 2 < joined.length) {
      const hex = joined.slice(index + 1, index + 3);

      if (/^[0-9a-f]{2}$/i.test(hex)) {
        bytes.push(Number.parseInt(hex, 16));
        index += 2;

        continue;
      }
    }

    bytes.push(...Buffer.from(character, 'utf8'));
  }

  return Buffer.from(bytes);
};

/**
 * Decodes the `=?utf-8?B?…?=` words a header uses for anything but ASCII.
 *
 * Subjects and display names arrive encoded far more often than not — a name in
 * Cyrillic, an Uzbek subject line — and a header shown raw is unreadable to the
 * person the assistant is answering.
 */
const decodeHeaderValue = (value: string): string => {
  // Folded headers continue on a following line that starts with whitespace.
  const unfolded = value.replace(/\r?\n[ \t]+/g, ' ').trim();

  return unfolded.replace(
    /=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g,
    (whole, charset: string, kind: string, text: string) => {
      try {
        const bytes =
          kind.toLowerCase() === 'b'
            ? Buffer.from(text, 'base64')
            : decodeQuotedPrintable(text.replace(/_/g, ' '));

        return bytes.toString(encodingFor(charset));
      } catch {
        return whole;
      }
    },
  );
};

const headerField = (headers: string, name: string): string => {
  const match = new RegExp(`^${name}:[ \\t]*([\\s\\S]*?)(?=\\r?\\n[^ \\t]|$)`, 'im').exec(headers);

  return match?.[1] === undefined ? '' : decodeHeaderValue(match[1]);
};

const splitMessage = (raw: string): { headers: string; body: string } => {
  const separator = /\r?\n\r?\n/.exec(raw);

  if (!separator || separator.index === undefined) {
    return { headers: raw, body: '' };
  }

  return {
    headers: raw.slice(0, separator.index),
    body: raw.slice(separator.index + separator[0].length),
  };
};

const decodeBody = (body: string, headers: string): string => {
  const encoding = headerField(headers, 'Content-Transfer-Encoding').toLowerCase();
  const charset = /charset=("?)([^";\s]+)\1/i.exec(headerField(headers, 'Content-Type'))?.[2];

  if (encoding === 'base64') {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString(encodingFor(charset));
  }

  if (encoding === 'quoted-printable') {
    return decodeQuotedPrintable(body).toString(encodingFor(charset));
  }

  return body;
};

const stripHtml = (value: string): string =>
  value
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, ' ');

/**
 * The readable text of a message, whatever shape it arrived in.
 *
 * Mail is usually multipart: the same message as plain text and as HTML, often
 * with images and attachments alongside. The plain part is preferred because it
 * is what the sender wrote; HTML is stripped only when there is nothing else,
 * and an attachment's bytes are never walked into the model's context.
 */
const readableText = (raw: string): string => {
  const { headers, body } = splitMessage(raw);
  const contentType = headerField(headers, 'Content-Type');
  const boundary = /boundary=("?)([^";\s]+)\1/i.exec(contentType)?.[2];

  if (!/^multipart\//i.test(contentType.trim()) || boundary === undefined) {
    const text = decodeBody(body, headers);

    return /^text\/html/i.test(contentType.trim()) ? stripHtml(text) : text;
  }

  const parts = body.split(`--${boundary}`).slice(1, -1);
  const decoded = parts.map((part) => {
    const inner = splitMessage(part.replace(/^\r?\n/, ''));
    const innerType = headerField(inner.headers, 'Content-Type');

    // A nested multipart (mixed wrapping alternative, the commonest shape of
    // a message with an attachment) is read by the same rules, recursively.
    if (/^multipart\//i.test(innerType.trim())) {
      return { type: 'text/plain', text: readableText(part.replace(/^\r?\n/, '')) };
    }

    // An attachment is announced, never opened.
    if (/attachment/i.test(headerField(inner.headers, 'Content-Disposition'))) {
      return { type: 'attachment', text: '' };
    }

    return {
      type: innerType.split(';')[0]?.trim().toLowerCase() ?? 'text/plain',
      text: decodeBody(inner.body, inner.headers),
    };
  });

  const plain = decoded.find((part) => part.type === 'text/plain' && part.text.trim().length > 0);

  if (plain) {
    return plain.text;
  }

  const html = decoded.find((part) => part.type === 'text/html' && part.text.trim().length > 0);

  return html ? stripHtml(html.text) : '';
};

/* -------------------------------------------------------------------------- */
/* Reading                                                                    */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` as IMAP wants it: `8-Sep-2026`. */
const IMAP_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const imapDate = (value: string): string | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const [, year, month, day] = match;
  const name = IMAP_MONTHS[Number(month) - 1];

  return name === undefined ? null : `${Number(day)}-${name}-${year}`;
};

/**
 * Turns the caller's criteria into an IMAP search.
 *
 * Returns the term that has to travel as a literal separately from the rest: a
 * search string with a non-ASCII character in it cannot be quoted, and IMAP has
 * exactly one way to carry it. At most one such term is allowed per search,
 * which keeps the protocol dance to a single continuation.
 */
const buildSearch = (
  criteria: IcloudMailSearch,
): { command: string; literal: string | null; after: string } => {
  const terms: { key: string; value: string }[] = [];

  for (const [key, value] of [
    ['FROM', criteria.from],
    ['TO', criteria.to],
    ['SUBJECT', criteria.subject],
    ['TEXT', criteria.text],
  ] as const) {
    const trimmed = value?.trim();

    if (trimmed !== undefined && trimmed.length > 0) {
      terms.push({ key, value: trimmed });
    }
  }

  const dates: string[] = [];

  for (const [key, value] of [
    ['SINCE', criteria.since],
    ['BEFORE', criteria.before],
  ] as const) {
    const formatted = value === undefined ? null : imapDate(value);

    if (value !== undefined && formatted === null) {
      throw new McpError('protocol', `"${value}" is not a date. Use YYYY-MM-DD.`);
    }

    if (formatted !== null) {
      dates.push(`${key} ${formatted}`);
    }
  }

  const nonAscii = terms.filter((term) => /[^\x20-\x7e]/.test(term.value));

  if (nonAscii.length > 1) {
    throw new McpError(
      'protocol',
      'Only one search word may contain non-Latin characters. Search for one of them and narrow the results.',
    );
  }

  const literalTerm = nonAscii[0];
  const plain = terms.filter((term) => term !== literalTerm);
  const parts = [...dates, ...plain.map((term) => `${term.key} ${quoted(term.value)}`)];

  if (literalTerm === undefined) {
    const body = parts.length > 0 ? parts.join(' ') : 'ALL';

    return { command: `UID SEARCH ${body}`, literal: null, after: '' };
  }

  // The literal has to be the last thing on the line, so everything else is
  // sent before it and the search ends where the term does.
  const before = parts.length > 0 ? `${parts.join(' ')} ` : '';

  return {
    command: `UID SEARCH CHARSET UTF-8 ${before}${literalTerm.key} `,
    literal: literalTerm.value,
    after: '',
  };
};

/** Pairs each `* n FETCH` line with the literal that followed it. */
const fetchedLiterals = (reply: ImapReply): { uid: number; payload: string }[] => {
  const results: { uid: number; payload: string }[] = [];
  let index = 0;

  for (const line of reply.lines) {
    if (!/^\* \d+ FETCH /.test(line)) {
      continue;
    }

    const payload = reply.literals[index];

    index += 1;

    if (payload === undefined) {
      continue;
    }

    const uid = readNumber(line, 'UID');

    if (uid !== null) {
      results.push({ uid, payload });
    }
  }

  return results;
};

const headerFrom = (uid: number, payload: string): IcloudMailHeader => ({
  uid,
  from: sanitiseExternalText(headerField(payload, 'From'), 200),
  to: sanitiseExternalText(headerField(payload, 'To'), 200),
  subject: sanitiseExternalText(headerField(payload, 'Subject'), 300) || '(no subject)',
  date: sanitiseExternalText(headerField(payload, 'Date'), 60),
});

/**
 * Finds messages, newest first, and returns only their headers.
 *
 * Headers rather than bodies on purpose: a search is how the assistant works
 * out which message is meant, and pulling twenty full messages to answer "who
 * wrote about the invoice" would spend a context window on text nobody asked
 * for. The body arrives when a message is chosen, through `readIcloudMessage`.
 */
export const searchIcloudMail = async (
  email: string,
  appPassword: string,
  criteria: IcloudMailSearch,
  limit: number,
  timeoutMs = 30_000,
): Promise<IcloudMailHeader[]> => {
  const search = buildSearch(criteria);
  const session = await openSession(timeoutMs);

  try {
    await login(session, email, appPassword);

    const opened = await session.send('s1', 'EXAMINE "INBOX"');

    assertOk(opened, 's1', new McpError('protocol', 'iCloud would not open the inbox.'));

    const found =
      search.literal === null
        ? await session.send('s2', search.command)
        : await session.sendWithLiteral('s2', search.command, search.literal, search.after);

    assertOk(found, 's2', new McpError('protocol', 'iCloud refused the search.'));

    const line = found.lines.find((candidate) => /^\* SEARCH/i.test(candidate)) ?? '';
    const uids = line
      .replace(/^\* SEARCH/i, '')
      .trim()
      .split(/\s+/)
      .filter((value) => /^\d+$/.test(value))
      .map(Number);

    if (uids.length === 0) {
      await session.send('s4', 'LOGOUT');

      return [];
    }

    // Highest UID is newest, and the caller wants the newest few.
    const newest = uids.sort((left, right) => right - left).slice(0, limit);
    const headers = await session.send(
      's3',
      `UID FETCH ${newest.join(',')} (BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE)])`,
    );

    assertOk(headers, 's3', new McpError('protocol', 'iCloud would not return the messages.'));

    await session.send('s4', 'LOGOUT');

    const byUid = new Map(newest.map((uid, position) => [uid, position]));

    return fetchedLiterals(headers)
      .map(({ uid, payload }) => headerFrom(uid, payload))
      .sort((left, right) => (byUid.get(left.uid) ?? 0) - (byUid.get(right.uid) ?? 0));
  } finally {
    session.close();
  }
};

/**
 * Reads one message by UID.
 *
 * `BODY.PEEK[]<0.n>` asks for the first n bytes and, being a peek, leaves the
 * message unread in the person's own mail app. A long message is cut rather
 * than streamed: the assistant is answering a question about it, not archiving
 * it, and the caller is told when there was more.
 */
export const readIcloudMessage = async (
  email: string,
  appPassword: string,
  uid: number,
  maxCharacters: number,
  timeoutMs = 30_000,
): Promise<IcloudMailMessage> => {
  const session = await openSession(timeoutMs);

  try {
    await login(session, email, appPassword);

    const opened = await session.send('r1', 'EXAMINE "INBOX"');

    assertOk(opened, 'r1', new McpError('protocol', 'iCloud would not open the inbox.'));

    const fetched = await session.send(
      'r2',
      `UID FETCH ${uid} (BODY.PEEK[]<0.${MAX_MESSAGE_BYTES}>)`,
    );

    assertOk(fetched, 'r2', new McpError('protocol', 'iCloud would not return the message.'));

    await session.send('r3', 'LOGOUT');

    const [message] = fetchedLiterals(fetched);

    if (message === undefined) {
      throw new McpError('protocol', `There is no message with id ${uid} in the inbox.`);
    }

    const body = readableText(message.payload).replace(/\r\n/g, '\n').trim();
    const text = sanitiseExternalText(body, maxCharacters + 1);

    return {
      ...headerFrom(message.uid, splitMessage(message.payload).headers),
      text: text.slice(0, maxCharacters),
      truncated: text.length > maxCharacters,
    };
  } finally {
    session.close();
  }
};
