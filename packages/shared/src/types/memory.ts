import type { MemorySource, MemoryStatus, MemoryType } from '../constants/memory.js';
import type { Entity } from './entity.js';

/**
 * One thing the assistant remembers about a person.
 *
 * A memory is identified by `(user, type, key)`, so re-learning the same fact
 * updates it instead of accumulating near-duplicates.
 */
export interface Memory extends Entity {
  user: string;
  type: MemoryType;
  /** Stable, machine-readable name, e.g. `content_language`. */
  key: string;
  value: string;
  source: MemorySource;
  status: MemoryStatus;
  /** 0–1. Anything below the confirmation threshold is held as `pending`. */
  confidence: number;
  /** Conversation the memory was learned in, when it came from a chat. */
  conversation: string | null;
  /** ISO-8601; updated whenever the memory is used to answer something. */
  lastUsedAt: string | null;
  /** ISO-8601, set when the memory was forgotten. */
  deletedAt: string | null;
}
