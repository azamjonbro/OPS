import { ANALYTICS_CACHE_TTL_MS } from '@hadiya/shared';

/**
 * A short memory for expensive answers.
 *
 * Analytics questions arrive in clusters: "bugungi savdo qanday?" is very often
 * followed by "kecha bilan solishtir", and a multi-tool round asks for the same
 * window three times in one turn. Recomputing it means paying for the same Billz
 * pages again while the person waits.
 *
 * The critical property is isolation. Every key begins with the account it was
 * computed for, so there is no arrangement of arguments that lets one person's
 * question return another's figures — a cache is otherwise an excellent way to
 * build a cross-tenant leak that no permission check would ever see.
 *
 * In-process and deliberately small: this is a latency and cost optimisation
 * for a burst of related questions, not a data store. It is dropped on restart,
 * which is correct — figures about today should not outlive a deployment.
 */
interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, CacheEntry>();

/** Keeps a forgotten key from pinning a month of receipts in memory for ever. */
const MAX_ENTRIES = 200;

/**
 * The cache key for one question.
 *
 * The actor id is first and is never optional. Everything else that changes the
 * answer — the operation, the window, the filters — is folded in after it, so
 * two different questions cannot collide on one entry.
 */
export const analyticsCacheKey = (
  actorId: string,
  operation: string,
  parts: Record<string, unknown>,
): string => {
  const normalised = Object.keys(parts)
    .sort()
    .map((key) => `${key}=${JSON.stringify(parts[key]) ?? 'null'}`)
    .join('&');

  return `${actorId}::${operation}::${normalised}`;
};

export const readAnalyticsCache = <TValue>(key: string, now = Date.now()): TValue | null => {
  const entry = store.get(key);

  if (!entry) {
    return null;
  }

  if (entry.expiresAt <= now) {
    store.delete(key);

    return null;
  }

  return entry.value as TValue;
};

export const writeAnalyticsCache = (
  key: string,
  value: unknown,
  ttlMs = ANALYTICS_CACHE_TTL_MS,
  now = Date.now(),
): void => {
  if (store.size >= MAX_ENTRIES) {
    // Oldest insertion first. A precise LRU would need bookkeeping this does
    // not earn: entries live for a couple of minutes either way.
    const oldest = store.keys().next();

    if (!oldest.done) {
      store.delete(oldest.value);
    }
  }

  store.set(key, { value, expiresAt: now + ttlMs });
};

/** Testing seam, and what a sign-out would call if caching ever outlives a process. */
export const clearAnalyticsCache = (): void => {
  store.clear();
};
