import type { AuthenticatedUser } from '@hadiya/shared';

import type { MemoryDocument } from '../../memory/memory.model.js';
import * as memoryService from '../../memory/memory.service.js';

/**
 * Chooses which memories belong in a prompt.
 *
 * Kept behind an interface because the *selection* strategy is expected to
 * change while everything around it stays the same. Today it is keyword and
 * recency scoring over a bounded set, which needs no extra infrastructure. A
 * vector-backed retriever implements this same interface and replaces it
 * without the context builder or the agent noticing — that is the whole point
 * of the seam, and why no embedding column exists yet.
 */
export interface MemoryRetriever {
  readonly name: string;
  retrieve: (actor: AuthenticatedUser, query: string, limit: number) => Promise<ScoredMemory[]>;
}

export interface ScoredMemory {
  memory: MemoryDocument;
  /** Higher is more relevant. Only meaningful relative to the same query. */
  score: number;
}

/** Words too common to say anything about relevance. */
const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'you',
  'your',
  'are',
  'was',
  'men',
  'meni',
  'mening',
  'uchun',
  'bilan',
  'qanday',
  'nima',
  'bu',
  'shu',
]);

const MINIMUM_TOKEN_LENGTH = 3;

export const tokenise = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((token) => token.length >= MINIMUM_TOKEN_LENGTH && !STOP_WORDS.has(token));

/** How many candidates are scored before the best are taken. */
const CANDIDATE_POOL = 100;
/** Instructions and preferences steer every answer, so they start ahead. */
const TYPE_WEIGHT: Record<string, number> = { instruction: 1.5, preference: 1.2, fact: 1 };
const OVERLAP_WEIGHT = 2;
const RECENCY_WEIGHT = 0.5;
const RECENCY_WINDOW_DAYS = 30;

/**
 * Scores a memory on three things: how much of the question it shares words
 * with, what kind of memory it is, and how recently it was updated.
 *
 * Preferences and standing instructions are kept even when they share no words
 * with the question — "always answer briefly" is relevant to everything, and a
 * pure keyword match would drop exactly the memories that matter most.
 */
export class KeywordMemoryRetriever implements MemoryRetriever {
  readonly name = 'keyword';

  async retrieve(actor: AuthenticatedUser, query: string, limit: number): Promise<ScoredMemory[]> {
    const candidates = await memoryService.listActiveMemories(actor, CANDIDATE_POOL);

    if (candidates.length === 0) {
      return [];
    }

    const queryTokens = new Set(tokenise(query));
    const now = Date.now();

    const scored = candidates.map((memory) => {
      const memoryTokens = tokenise(`${memory.key} ${memory.value}`);
      const overlap = memoryTokens.filter((token) => queryTokens.has(token)).length;
      const ageDays = (now - memory.updatedAt.getTime()) / 86_400_000;
      const recency = Math.max(0, 1 - ageDays / RECENCY_WINDOW_DAYS);

      const score =
        (overlap * OVERLAP_WEIGHT + recency * RECENCY_WEIGHT) * (TYPE_WEIGHT[memory.type] ?? 1) +
        // Always-applicable memories keep a floor so they survive a query they
        // share no words with.
        (memory.type === 'fact' ? 0 : 1);

      return { memory, score };
    });

    return scored
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit);
  }
}

let retriever: MemoryRetriever = new KeywordMemoryRetriever();

export const getMemoryRetriever = (): MemoryRetriever => retriever;

/** Swaps the strategy — how a vector retriever will be introduced. */
export const setMemoryRetriever = (next: MemoryRetriever): void => {
  retriever = next;
};
