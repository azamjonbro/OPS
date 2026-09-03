import type { Logger } from 'pino';

declare module 'express-serve-static-core' {
  interface Request {
    /** Correlation id, echoed in the response envelope and the `x-request-id` header. */
    id: string;
    /** Monotonic timestamp taken when the request entered the app. */
    startedAt: number;
    /** Request-scoped logger, already bound to `id`. */
    log: Logger;
    /**
     * Output of `validate()`. Typed access goes through `validated()` in
     * `core/middleware/validate.ts`; handlers never read this field directly.
     */
    validated?: { body?: unknown; query?: unknown; params?: unknown };
  }
}
