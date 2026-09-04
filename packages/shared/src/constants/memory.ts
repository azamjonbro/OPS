/**
 * What a remembered fact is about.
 *
 * The type decides how a memory is used, not just how it is labelled:
 * `preference` shapes how the assistant answers, `fact` is context about the
 * business or the person, and `instruction` is a standing request to follow.
 */
export const MEMORY_TYPES = ['preference', 'fact', 'instruction'] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

/**
 * `pending` exists for anything the assistant is not confident enough to keep
 * on its own: it is stored but never used until a person confirms it.
 * `deleted` is a tombstone — forgetting hides a memory rather than erasing the
 * record that it once existed.
 */
export const MEMORY_STATUSES = ['active', 'pending', 'deleted'] as const;

export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

/** Where a memory came from, which decides how much it is trusted. */
export const MEMORY_SOURCES = ['user', 'assistant', 'system'] as const;

export type MemorySource = (typeof MEMORY_SOURCES)[number];

/** Below this, a memory is held as `pending` until someone confirms it. */
export const MEMORY_CONFIRMATION_THRESHOLD = 0.7;

/** How many memories the context builder is allowed to put in one prompt. */
export const MEMORY_CONTEXT_LIMIT = 12;
