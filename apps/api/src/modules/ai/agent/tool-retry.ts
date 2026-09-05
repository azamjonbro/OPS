import { ApiError } from '../../../core/http/api-error.js';
import type { ToolPlan } from '../tools/tool-registry.js';

/**
 * Which failures are worth trying again, and which are the answer.
 *
 * The distinction is not "did it fail" but "would the same call, made again,
 * plausibly do something different". A network that dropped, a server that was
 * briefly busy, a request that timed out — all of those are worth a second
 * attempt. Arguments that do not validate, a tool the person has blocked, a
 * credential the far side rejected: repeating those wastes time and, on a rate
 * limit that is actually a quota, digs the hole deeper.
 *
 * There is a second gate on top of the first, and it is the one that matters
 * most: a call that changes data is not retried unless it is safe to run twice.
 * A timeout is precisely the case where the request may well have arrived —
 * "the invoice was created and the answer got lost" and "the invoice was never
 * created" look identical from here — so retrying a write on a timeout is how
 * one invoice becomes two. Reads are retried freely; writes only when the tool
 * says it is idempotent.
 */

export type FailureKind =
  | 'timeout'
  | 'network'
  | 'rate_limited'
  | 'unavailable'
  | 'invalid'
  | 'not_allowed'
  | 'authentication'
  | 'unknown';

/** Kinds that describe a moment rather than a state of the world. */
const TRANSIENT: readonly FailureKind[] = ['timeout', 'network', 'rate_limited', 'unavailable'];

export const isTransientKind = (kind: FailureKind): boolean => TRANSIENT.includes(kind);

/** An error carrying an MCP failure kind, without importing the hub here. */
const mcpKindOf = (error: unknown): string | null => {
  if (typeof error !== 'object' || error === null) {
    return null;
  }

  const candidate = error as { name?: unknown; kind?: unknown };

  return candidate.name === 'McpError' && typeof candidate.kind === 'string'
    ? candidate.kind
    : null;
};

/** Thrown by the scheduler when a call outlives its deadline. */
export class ToolTimeoutError extends Error {
  constructor(toolName: string, timeoutMs: number) {
    super(`The "${toolName}" tool did not answer within ${Math.round(timeoutMs / 1_000)}s.`);
    this.name = 'ToolTimeoutError';
  }
}

/** Thrown when a run is cancelled while a call is waiting to start. */
export class ToolCancelledError extends Error {
  constructor(toolName: string) {
    super(`The "${toolName}" tool was cancelled.`);
    this.name = 'ToolCancelledError';
  }
}

/**
 * Reads an unknown throw and names the kind of failure it was.
 *
 * Ordered from the most specific evidence to the least. Anything unrecognised
 * is `unknown`, which is not retried — the conservative reading, because an
 * error nobody has classified is as likely to be a bug as a blip, and repeating
 * a bug three times only makes the log longer.
 */
export const classifyFailure = (error: unknown): FailureKind => {
  if (error instanceof ToolTimeoutError) {
    return 'timeout';
  }

  const mcpKind = mcpKindOf(error);

  if (mcpKind) {
    switch (mcpKind) {
      case 'timeout':
        return 'timeout';
      case 'unreachable':
        return 'network';
      case 'rate_limited':
        return 'rate_limited';
      case 'authentication':
        return 'authentication';
      case 'not_allowed':
        return 'not_allowed';
      default:
        // `protocol` and `tool_failed` are the far side answering coherently
        // with a "no". Repeating the question does not change the answer.
        return 'invalid';
    }
  }

  if (error instanceof ApiError) {
    if (error.statusCode === 429) {
      return 'rate_limited';
    }

    if (error.statusCode === 503) {
      return 'unavailable';
    }

    if (error.statusCode === 401) {
      return 'authentication';
    }

    if (error.statusCode === 403) {
      return 'not_allowed';
    }

    // Everything else with a 4xx is the caller's fault and stays the caller's
    // fault however many times it is sent.
    return error.statusCode >= 400 && error.statusCode < 500 ? 'invalid' : 'unknown';
  }

  if (error instanceof Error) {
    const text = `${error.name}: ${error.message}`.toLowerCase();

    if (error.name === 'AbortError' || text.includes('timeout') || text.includes('timed out')) {
      return 'timeout';
    }

    if (
      text.includes('econnreset') ||
      text.includes('econnrefused') ||
      text.includes('enotfound') ||
      text.includes('eai_again') ||
      text.includes('socket hang up') ||
      text.includes('network')
    ) {
      return 'network';
    }

    if (text.includes('429') || text.includes('rate limit')) {
      return 'rate_limited';
    }

    if (text.includes('503') || text.includes('502') || text.includes('504')) {
      return 'unavailable';
    }
  }

  return 'unknown';
};

export interface RetryDecision {
  retry: boolean;
  kind: FailureKind;
  /** Why not, when `retry` is false. Written for a log line, not for a person. */
  reason: string;
}

/**
 * Whether this failure of this tool, on this attempt, may be tried again.
 *
 * The order of the checks is the order of the rules' authority: a destructive
 * tool is never retried whatever went wrong, a write is retried only when it is
 * safe to repeat, and only then does the kind of failure get a say.
 */
export const shouldRetry = (options: {
  error: unknown;
  plan: ToolPlan;
  attempt: number;
  maxRetries: number;
}): RetryDecision => {
  const kind = classifyFailure(options.error);

  if (options.plan.risk === 'destructive') {
    return { retry: false, kind, reason: 'destructive tools are never retried automatically' };
  }

  if (options.plan.mutates && !options.plan.idempotent) {
    return {
      retry: false,
      kind,
      reason: 'the tool writes and is not safe to repeat',
    };
  }

  if (options.attempt > options.maxRetries) {
    return { retry: false, kind, reason: 'the retry budget is spent' };
  }

  if (!isTransientKind(kind)) {
    return { retry: false, kind, reason: `a ${kind} failure does not change on a retry` };
  }

  return { retry: true, kind, reason: '' };
};

/**
 * How long to wait before attempt `attempt + 1`.
 *
 * Doubling, with a little noise on top so that a hundred calls that all failed
 * against the same busy server do not all come back at the same instant.
 */
export const backoffFor = (attempt: number, baseMs: number): number => {
  if (baseMs <= 0) {
    return 0;
  }

  const exponential = baseMs * 2 ** (attempt - 1);

  return Math.round(exponential * (1 + Math.random() * 0.25));
};

export const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    // A cancelled run should not sit out a backoff it will never use.
    function onAbort(): void {
      clearTimeout(timer);
      resolve();
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
