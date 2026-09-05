import { config } from '../../../config/index.js';
import { createLogger } from '../../../core/logger/logger.js';
import { McpError } from '../mcp/mcp-error.js';
import { sanitiseExternalText } from '../mcp/mcp-tool-schema.js';

const log = createLogger('notion');

/**
 * A small, deliberately narrow Notion client.
 *
 * Narrow is the design. Notion's API can create pages, edit blocks and delete
 * databases; this speaks four endpoints, all of them reads, because Hadiya's
 * job with Notion is to *find* what the person wrote — a supplier's terms, last
 * month's plan — and quote it back in the conversation. Widening it is a
 * decision someone should have to make on purpose, and it is one function away
 * when they do.
 *
 * `McpError` is reused for failures despite the name: it is Hadiya's vocabulary
 * for "something outside failed, here is the safe way to say so", and Notion's
 * failures classify the same way an MCP server's do. The alternative was a
 * second error class identical in every respect but its name.
 */

export interface NotionSearchHit {
  id: string;
  /** Best available title; Notion does not guarantee one. */
  title: string;
  /** `page` or `database`. */
  object: string;
  url: string | null;
  lastEditedAt: string | null;
}

export interface NotionIdentity {
  /** The bot or workspace name, as Notion reports it. */
  name: string;
  workspaceName: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Digs a readable title out of a Notion object.
 *
 * Notion stores titles in three different shapes depending on whether the thing
 * is a database, a page in a database, or a page in a workspace, and none of
 * them is guaranteed to be populated. Rather than model all of it, this walks
 * for the first rich-text run it can find and gives up gracefully.
 */
const readTitle = (record: Record<string, unknown>): string => {
  const fromRichText = (value: unknown): string | null => {
    if (!Array.isArray(value)) {
      return null;
    }

    const text = value
      .map((run) => (isRecord(run) && typeof run.plain_text === 'string' ? run.plain_text : ''))
      .join('')
      .trim();

    return text.length > 0 ? text : null;
  };

  const direct = fromRichText(record.title);

  if (direct) {
    return direct;
  }

  const properties = record.properties;

  if (isRecord(properties)) {
    for (const property of Object.values(properties)) {
      if (isRecord(property) && property.type === 'title') {
        const title = fromRichText(property.title);

        if (title) {
          return title;
        }
      }
    }
  }

  return 'Untitled';
};

/**
 * One request to Notion, with a deadline and a normalised failure.
 *
 * The token goes into the header and nowhere else — not into the log line, not
 * into the error, not into the returned object. What is logged is the endpoint
 * and the status, which is what a person debugging this actually needs.
 */
const request = async (
  token: string,
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown },
): Promise<unknown> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.integrations.notion.timeoutMs);

  try {
    const response = await fetch(`${config.integrations.notion.baseUrl}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': config.integrations.notion.apiVersion,
        'Content-Type': 'application/json',
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: controller.signal,
    });

    if (!response.ok) {
      log.warn({ path, status: response.status }, 'Notion request failed');

      if (response.status === 401 || response.status === 403) {
        throw new McpError('authentication', 'Notion refused the saved token.');
      }

      if (response.status === 429) {
        throw new McpError('rate_limited', 'Notion is rate limiting this workspace.');
      }

      // The body may quote the request, so it is never read into a message.
      throw new McpError('unreachable', 'Notion returned an error.');
    }

    return await response.json();
  } catch (error) {
    if (error instanceof McpError) {
      throw error;
    }

    if (error instanceof Error && error.name === 'AbortError') {
      throw new McpError('timeout', 'Notion took too long to answer.');
    }

    log.warn({ path, err: error }, 'Notion request failed');

    throw new McpError('unreachable', 'Notion could not be reached.');
  } finally {
    clearTimeout(timer);
  }
};

/** Who the stored token belongs to. The health check, and nothing more. */
export const getNotionIdentity = async (token: string): Promise<NotionIdentity> => {
  const body = await request(token, '/v1/users/me', { method: 'GET' });
  const record = isRecord(body) ? body : {};
  const bot = isRecord(record.bot) ? record.bot : {};
  const workspaceName = typeof bot.workspace_name === 'string' ? bot.workspace_name : null;

  return {
    // Notion's own text, bounded like any other external string.
    name: sanitiseExternalText(typeof record.name === 'string' ? record.name : '', 80) || 'Notion',
    workspaceName: workspaceName ? sanitiseExternalText(workspaceName, 80) : null,
  };
};

/**
 * Searches the pages and databases the integration has been given access to.
 *
 * Notion's permission model does the important work here: a token only sees
 * what its workspace owner explicitly shared with the integration, so the blast
 * radius of a connected Notion is decided in Notion, by the person who owns it.
 */
export const searchNotion = async (
  token: string,
  params: { query: string; limit: number },
): Promise<NotionSearchHit[]> => {
  const body = await request(token, '/v1/search', {
    method: 'POST',
    body: {
      query: params.query,
      page_size: Math.min(params.limit, 50),
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
    },
  });

  const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];

  return results.filter(isRecord).map((record) => ({
    id: typeof record.id === 'string' ? record.id : '',
    title: sanitiseExternalText(readTitle(record), 200),
    object: typeof record.object === 'string' ? record.object : 'unknown',
    url: typeof record.url === 'string' ? record.url : null,
    lastEditedAt: typeof record.last_edited_time === 'string' ? record.last_edited_time : null,
  }));
};

/** The text of one page, flattened enough for a model to quote. */
export const readNotionPage = async (
  token: string,
  pageId: string,
): Promise<{ title: string; text: string }> => {
  const page = await request(token, `/v1/pages/${encodeURIComponent(pageId)}`, { method: 'GET' });
  const blocks = await request(
    token,
    `/v1/blocks/${encodeURIComponent(pageId)}/children?page_size=100`,
    { method: 'GET' },
  );

  const results = isRecord(blocks) && Array.isArray(blocks.results) ? blocks.results : [];
  const lines: string[] = [];

  for (const block of results) {
    if (!isRecord(block) || typeof block.type !== 'string') {
      continue;
    }

    const content = block[block.type];

    if (isRecord(content) && Array.isArray(content.rich_text)) {
      const text = content.rich_text
        .map((run) => (isRecord(run) && typeof run.plain_text === 'string' ? run.plain_text : ''))
        .join('')
        .trim();

      if (text.length > 0) {
        lines.push(text);
      }
    }
  }

  return {
    title: sanitiseExternalText(isRecord(page) ? readTitle(page) : 'Untitled', 200),
    // Bounded: a Notion page can be very long, and this text is going into a
    // context window.
    text: sanitiseExternalText(lines.join('\n'), 6_000),
  };
};
