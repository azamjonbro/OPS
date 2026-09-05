import { ApiError } from '../../../core/http/api-error.js';

/**
 * What went wrong with somebody else's server, said in a way that helps.
 *
 * Two audiences, and they want opposite things. A shopkeeper needs "CRM bilan
 * bog'lanib bo'lmadi" and one thing to try. Whoever reads the logs needs the
 * status code, the host and the underlying message. Mixing them produces the
 * failure mode this class exists to prevent: a raw upstream response — which
 * may quote the request, and therefore the bearer token that was in it —
 * rendered onto a screen or into an error field in the database.
 *
 * So `message` is written for a person and is the only thing that ever leaves
 * the process; the original is kept as `cause` for the logger and goes no
 * further.
 */
export type McpFailureKind =
  | 'unreachable'
  | 'timeout'
  | 'authentication'
  | 'protocol'
  | 'tool_failed'
  | 'rate_limited'
  | 'not_allowed';

const MESSAGES: Record<McpFailureKind, string> = {
  unreachable: 'The server could not be reached.',
  timeout: 'The server took too long to answer.',
  authentication: 'The server refused the saved credential.',
  protocol: 'The server answered in a way Hadiya did not understand.',
  tool_failed: 'The tool did not complete.',
  rate_limited: 'Too many requests were made to this integration; try again shortly.',
  not_allowed: 'That tool is not allowed to run.',
};

export class McpError extends Error {
  readonly kind: McpFailureKind;
  /** Written for a person; safe to show and safe to store. */
  readonly safeMessage: string;

  constructor(kind: McpFailureKind, safeMessage?: string, options?: { cause?: unknown }) {
    super(safeMessage ?? MESSAGES[kind], options);
    this.name = 'McpError';
    this.kind = kind;
    this.safeMessage = safeMessage ?? MESSAGES[kind];
  }

  /** The HTTP answer this failure deserves. */
  toApiError(integrationName: string): ApiError {
    const message = `${integrationName}: ${this.safeMessage}`;

    switch (this.kind) {
      case 'authentication':
        return ApiError.badRequest(message, { cause: this });
      case 'rate_limited':
        return ApiError.rateLimited(message, { cause: this });
      case 'not_allowed':
        return ApiError.forbidden(message, { cause: this });
      default:
        // Unreachable, slow or incoherent are all "the dependency is not
        // working", which is a 503 and not the caller's fault.
        return ApiError.dependencyUnavailable(message, { cause: this });
    }
  }
}

export const isMcpError = (error: unknown): error is McpError => error instanceof McpError;

/**
 * Reads an unknown throw and decides what kind of failure it was.
 *
 * The classification comes from shapes the SDK, `fetch` and Node's networking
 * actually produce. Anything unrecognised becomes `unreachable` with the
 * standard text — deliberately, because the alternative is passing an
 * unexamined string outward, and an unexamined string is how a token ends up in
 * an error field.
 */
export const toMcpError = (error: unknown): McpError => {
  if (isMcpError(error)) {
    return error;
  }

  if (error instanceof Error) {
    const text = `${error.name}: ${error.message}`.toLowerCase();

    if (text.includes('timeout') || text.includes('timed out') || text.includes('aborted')) {
      return new McpError('timeout', undefined, { cause: error });
    }

    if (
      text.includes('401') ||
      text.includes('403') ||
      text.includes('unauthorized') ||
      text.includes('forbidden')
    ) {
      return new McpError('authentication', undefined, { cause: error });
    }

    if (text.includes('429') || text.includes('rate limit')) {
      return new McpError('rate_limited', undefined, { cause: error });
    }

    if (
      text.includes('parse') ||
      text.includes('json') ||
      text.includes('invalid') ||
      text.includes('schema')
    ) {
      return new McpError('protocol', undefined, { cause: error });
    }
  }

  return new McpError('unreachable', undefined, { cause: error });
};
