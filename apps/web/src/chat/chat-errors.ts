import { isApiClientError } from '@/services/api-error';

/**
 * What went wrong with a turn, said in a way that helps.
 *
 * The API's own message is written for whoever is reading the logs; it can name
 * a provider, a limit or a dependency, and it is never what a shopkeeper should
 * read. So the *code* is translated here and the message is dropped, except for
 * validation, where the server is describing the person's own input and is the
 * only thing that knows what was wrong with it.
 *
 * Nothing in this file can emit a status code, a request id, a stack or a
 * credential, because none of them is ever read.
 *
 * The one thing read besides the code is `details.kind`, which the API sets to
 * its own classification of the failure. A code alone is too coarse in one
 * case that matters: an exhausted account and an unreachable model are both
 * `DEPENDENCY_UNAVAILABLE`, and only one of them is worth waiting out.
 */
export interface ChatError {
  message: string;
  /** Whether sending the same turn again is worth offering. */
  retriable: boolean;
}

const MESSAGES: Record<string, ChatError> = {
  NETWORK_ERROR: {
    message: 'Could not reach Hadiya. Check your connection and try again.',
    retriable: true,
  },
  DEPENDENCY_UNAVAILABLE: {
    message: 'The AI service is not responding right now. Please try again in a moment.',
    retriable: true,
  },
  RATE_LIMITED: {
    message: 'Too many requests just now. Wait a few seconds and try again.',
    retriable: true,
  },
  INTERNAL_ERROR: {
    message: 'Something went wrong while answering. Please try again.',
    retriable: true,
  },
  UNAUTHENTICATED: {
    message: 'Your session has expired. Sign in again to continue the conversation.',
    retriable: false,
  },
  UNAUTHORIZED: {
    message: 'You do not have access to this conversation.',
    retriable: false,
  },
  NOT_FOUND: {
    message: 'This conversation no longer exists.',
    retriable: false,
  },
  PAYLOAD_TOO_LARGE: {
    message: 'That message is too long. Shorten it and send it again.',
    retriable: false,
  },
  CONFLICT: {
    message: 'That could not be completed. Try rephrasing what you asked for.',
    retriable: true,
  },
};

/**
 * Failures the API classifies more precisely than its status code can.
 *
 * `quota_exhausted` is the reason this exists. It arrives as
 * `DEPENDENCY_UNAVAILABLE`, which would otherwise read as "the service is not
 * responding, try again in a moment" — advice that will be just as wrong
 * tomorrow, because the account is empty rather than busy. Somebody has to top
 * it up, and nothing happens until they know that.
 */
const KINDS: Record<string, ChatError> = {
  quota_exhausted: {
    message: 'The AI account has run out of credit. Top it up to keep using Hadiya.',
    // Not retriable: an empty balance does not refill while you wait.
    retriable: false,
  },
};

/** The API's own classification, when it sent one. */
const readKind = (details: unknown): string | undefined => {
  if (typeof details !== 'object' || details === null) {
    return undefined;
  }

  const kind = (details as { kind?: unknown }).kind;

  return typeof kind === 'string' ? kind : undefined;
};

const TIMEOUT: ChatError = {
  message: 'Hadiya took too long to answer. Please try again.',
  retriable: true,
};

const FALLBACK: ChatError = {
  message: 'Something went wrong. Please try again.',
  retriable: true,
};

/** True for an Axios timeout, which arrives as a network failure with a code. */
const isTimeout = (error: unknown): boolean => {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;

  return cause?.code === 'ECONNABORTED' || cause?.code === 'ETIMEDOUT';
};

export const toChatError = (error: unknown): ChatError => {
  if (!isApiClientError(error)) {
    return FALLBACK;
  }

  if (error.code === 'VALIDATION_ERROR') {
    // The server is describing what the person typed, so its wording is the
    // useful one — it knows the message was empty or over the length limit.
    return { message: error.message, retriable: false };
  }

  if (error.code === 'NETWORK_ERROR' && isTimeout(error)) {
    return TIMEOUT;
  }

  // Checked before the code, because it is the more specific of the two.
  const kind = readKind(error.details);

  if (kind && KINDS[kind]) {
    return KINDS[kind];
  }

  return MESSAGES[error.code] ?? FALLBACK;
};

/**
 * An answer that came back empty.
 *
 * Rare, and worth its own sentence: "the assistant said nothing" is not a
 * failure the person caused, and offering a retry is the only useful response.
 */
export const EMPTY_ANSWER: ChatError = {
  message: 'Hadiya did not return an answer. Please try again.',
  retriable: true,
};
