import {
  CONTENT_PLATFORMS,
  CONTENT_PREFERENCE_KEYS,
  CONTENT_TONES,
  type AuthenticatedUser,
  type ContentPlatform,
  type ContentPreferences,
  type ContentTone,
} from '@hadiya/shared';

import * as memoryService from '../memory/memory.service.js';

/**
 * What the engine knows about how this person wants to be written for.
 *
 * The source is Phase 5 memory, and only its `active` rows: a `pending` memory
 * is something the assistant guessed and nobody confirmed, and a `deleted` one
 * is something they asked to be forgotten. Letting either shape a caption would
 * quietly reintroduce it — the user would be reading the consequences of a
 * memory they never agreed to, or explicitly dropped, with nothing on screen to
 * explain why the tone changed.
 *
 * Every field is nullable and nothing is defaulted. A missing tone means the
 * model is not told a tone, which is different from being told "friendly".
 */
const isPlatform = (value: string): value is ContentPlatform =>
  (CONTENT_PLATFORMS as readonly string[]).includes(value);

const isTone = (value: string): value is ContentTone =>
  (CONTENT_TONES as readonly string[]).includes(value);

export const EMPTY_PREFERENCES: ContentPreferences = {
  language: null,
  tone: null,
  style: null,
  platform: null,
  brandVoice: null,
  audience: null,
};

/** How many memories are scanned; far more than the handful of keys we read. */
const PREFERENCE_SCAN_LIMIT = 100;

export const loadContentPreferences = async (
  actor: AuthenticatedUser,
): Promise<ContentPreferences> => {
  const { items } = await memoryService.listMemories(actor, {
    page: 1,
    pageSize: PREFERENCE_SCAN_LIMIT,
    // The whole point: pending and deleted memories are never asked for.
    status: 'active',
  });

  const byKey = new Map(items.map((memory) => [memory.key, memory.value.trim()]));
  const read = (key: string): string | null => {
    const value = byKey.get(key);

    return value && value.length > 0 ? value : null;
  };

  const tone = read(CONTENT_PREFERENCE_KEYS.tone)?.toLowerCase() ?? null;
  const platform = read(CONTENT_PREFERENCE_KEYS.platform)?.toLowerCase() ?? null;

  return {
    language: read(CONTENT_PREFERENCE_KEYS.language),
    // A stored tone outside the vocabulary is dropped rather than passed on
    // raw: the prompt says "Tone: X", and an unrecognised X is noise.
    tone: tone && isTone(tone) ? tone : null,
    style: read(CONTENT_PREFERENCE_KEYS.style),
    platform: platform && isPlatform(platform) ? platform : null,
    brandVoice: read(CONTENT_PREFERENCE_KEYS.brandVoice),
    audience: read(CONTENT_PREFERENCE_KEYS.audience),
  };
};

/** The preferences that were actually applied, for showing back to a person. */
export const describeAppliedPreferences = (preferences: ContentPreferences): string[] =>
  Object.entries(preferences)
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}: ${String(value)}`);
