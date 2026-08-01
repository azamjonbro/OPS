/**
 * Minimal in-memory TTL cache with single-flight de-duplication.
 *
 * Two problems it solves:
 *  1. Repeated identical calls (e.g. the same Billz sales query) hit the remote API every time.
 *  2. Concurrent identical calls all fire before the first one has a chance to populate the cache.
 *
 * `wrap()` handles both: a hit returns instantly, and concurrent misses share one in-flight promise.
 */
class TtlCache {
  constructor() {
    this.entries = new Map();   // key -> { value, expiresAt }
    this.inFlight = new Map();  // key -> Promise
    this.stats = { hits: 0, misses: 0, deduped: 0 };
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Return the cached value for `key`, otherwise run `producer()` and cache its result.
   * Concurrent callers for the same key await the same promise instead of each calling `producer`.
   */
  async wrap(key, ttlMs, producer) {
    const cached = this.get(key);
    if (cached !== undefined) {
      this.stats.hits++;
      return cached;
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      this.stats.deduped++;
      return pending;
    }

    this.stats.misses++;
    const promise = (async () => {
      try {
        const value = await producer();
        this.set(key, value, ttlMs);
        return value;
      } finally {
        this.inFlight.delete(key);
      }
    })();

    this.inFlight.set(key, promise);
    return promise;
  }

  /** Drop every entry whose key contains `substring` (used to bust reads after a write). */
  invalidate(substring) {
    for (const key of this.entries.keys()) {
      if (key.includes(substring)) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
    this.inFlight.clear();
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses + this.stats.deduped;
    return {
      ...this.stats,
      size: this.entries.size,
      hitRate: total > 0 ? `${Math.round(((this.stats.hits + this.stats.deduped) / total) * 100)}%` : '0%'
    };
  }
}

module.exports = new TtlCache();
