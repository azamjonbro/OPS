/**
 * Turning what somebody typed into a search into something a database can be
 * given safely.
 *
 * Every `search` parameter in Hadiya ends up in a MongoDB `$regex`, and a
 * regular expression is a small programming language: handed one directly, a
 * caller is not searching, they are writing code that the database server runs
 * against every candidate document.
 *
 * Two things go wrong with that, and both were reachable from an ordinary
 * signed-in request:
 *
 *  - **A malformed pattern is a server error.** `([` is not a regex, so Mongo
 *    refuses the whole command and the API answers `500` with a driver error
 *    behind it. A typed bracket is not a bug report.
 *  - **A well-formed pattern can be a denial of service.** Nested quantifiers
 *    — `(a+)+(a+)+$` — backtrack catastrophically, and the backtracking happens
 *    inside the database, per document, on a thread the rest of the deployment
 *    is waiting for.
 *
 * There is also a quieter correctness problem: `.` matching any character means
 * a search for `secre.` finds `secret_key`, which is not what anybody typing
 * into a search box means.
 *
 * So a search term is treated as literal text. Every metacharacter is escaped,
 * and the length is bounded, before it is ever given to the database.
 */

/**
 * The characters that mean something to a regex engine.
 *
 * `-` is included because it is special inside a character class, and escaping
 * it costs nothing outside one.
 */
const REGEX_METACHARACTERS = /[.*+?^${}()|[\]\\\-/]/g;

/**
 * The longest search term that reaches the database.
 *
 * Well below any validator's own limit; the point is that this function is safe
 * on its own, wherever it is called from, including from a tool argument the
 * model wrote.
 */
export const MAX_SEARCH_TERM_LENGTH = 120;

/**
 * Escapes a string so a regex engine reads it as the literal characters it
 * contains.
 *
 * ```ts
 * escapeRegExp('a.b*c') // 'a\\.b\\*c'
 * ```
 */
export const escapeRegExp = (value: string): string =>
  value.replace(REGEX_METACHARACTERS, (character) => `\\${character}`);

/**
 * A `$regex` filter fragment for a free-text search, or `null` when there is
 * nothing to search for.
 *
 * Returning the fragment rather than the escaped string keeps the options in
 * one place too: case-insensitive, and never any flag a caller could choose.
 */
export const searchRegexFilter = (
  term: string | null | undefined,
): { $regex: string; $options: string } | null => {
  const trimmed = (term ?? '').trim();

  if (trimmed.length === 0) {
    return null;
  }

  return { $regex: escapeRegExp(trimmed.slice(0, MAX_SEARCH_TERM_LENGTH)), $options: 'i' };
};
