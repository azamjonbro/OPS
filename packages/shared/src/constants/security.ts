/**
 * The limits that exist to stop somebody, rather than to tune something.
 *
 * They live in the shared package for the same reason every other limit does —
 * the client needs to explain a refusal it did not cause — but the enforcement
 * is entirely server-side. A browser that ignores every number here gets
 * exactly the same answers.
 */

/**
 * Sign-in attempts.
 *
 * The global limiter counts every request from an address together, which for
 * a shop behind one connection means ordinary traffic and password guessing
 * share a budget of several hundred a minute. That is not a brute-force
 * defence: an account with a weak password falls to it in an afternoon.
 *
 * So sign-in gets a budget of its own, counted per address *and* per username,
 * over a long enough window that a locked-out person waits minutes rather than
 * a lifetime. Successful sign-ins do not count against it, so somebody typing
 * their own password correctly is never throttled by their colleagues.
 */
export const LOGIN_RATE_LIMIT = {
  windowMs: 15 * 60 * 1_000,
  /** Failed attempts per address, per username, per window. */
  max: 10,
} as const;

/**
 * Token refresh.
 *
 * Looser than sign-in — a legitimate client refreshes on a timer and several
 * tabs refresh independently — but still bounded: a refresh is an unauthenticated
 * endpoint that does a signature check and a database read, and an endpoint like
 * that with no ceiling is a free amplifier.
 */
export const REFRESH_RATE_LIMIT = {
  windowMs: 15 * 60 * 1_000,
  max: 60,
} as const;

/**
 * Turns costing money.
 *
 * A chat turn can spend several completions and a dozen external calls; an
 * image is billed per picture. Neither is protected by the global limiter,
 * which is sized for cheap requests. Counted per account rather than per
 * address, for the same reason dictation is: a shop's staff share one
 * connection and must not share one person's runaway loop.
 */
export const CHAT_RATE_LIMIT = {
  windowMs: 60 * 1_000,
  max: 30,
} as const;

export const IMAGE_RATE_LIMIT = {
  windowMs: 60 * 1_000,
  max: 10,
} as const;

/** Uploads are bounded per file already; this bounds how many arrive. */
export const UPLOAD_RATE_LIMIT = {
  windowMs: 60 * 1_000,
  max: 30,
} as const;
