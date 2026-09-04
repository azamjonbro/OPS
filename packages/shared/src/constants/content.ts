/**
 * Where content is meant to go.
 *
 * A closed list rather than a free string: the platform decides what a caption
 * may look like, how many hashtags are sensible and which content types make
 * sense, so an unrecognised value would be carried through the whole engine
 * with nothing able to act on it. Adding one is a single line here plus an
 * entry in `PLATFORM_PROFILES` — no migration, because nothing stores a
 * platform-specific shape.
 */
export const CONTENT_PLATFORMS = ['instagram', 'telegram', 'tiktok', 'facebook'] as const;

export type ContentPlatform = (typeof CONTENT_PLATFORMS)[number];

/**
 * What a piece of content is.
 *
 * Deliberately broad, and mixing format (`reel`, `carousel`) with intent
 * (`educational`, `promotional`) because that is how people actually brief this
 * work — "a promotional reel" is one item, not two axes. `other` is the escape
 * hatch so an unforeseen format is stored as itself with a note rather than
 * forced into the nearest wrong bucket.
 */
export const CONTENT_TYPES = [
  'post',
  'reel',
  'story',
  'carousel',
  'video',
  'educational',
  'promotional',
  'product',
  'announcement',
  'other',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** A plan's lifecycle. `archived` hides it without destroying the work. */
export const CONTENT_PLAN_STATUSES = ['draft', 'active', 'completed', 'archived'] as const;

export type ContentPlanStatus = (typeof CONTENT_PLAN_STATUSES)[number];

/**
 * One item's progress. `idea` is a topic with no copy yet; `draft` has copy;
 * `ready` is approved; `published` is a claim the person makes, not something
 * Hadiya observes — there is no publishing integration behind it.
 */
export const CONTENT_ITEM_STATUSES = ['idea', 'draft', 'ready', 'published', 'skipped'] as const;

export type ContentItemStatus = (typeof CONTENT_ITEM_STATUSES)[number];

/** How the copy should sound. Also the vocabulary a stored preference uses. */
export const CONTENT_TONES = [
  'friendly',
  'professional',
  'playful',
  'informative',
  'inspirational',
  'urgent',
] as const;

export type ContentTone = (typeof CONTENT_TONES)[number];

/**
 * Per-platform limits and habits, used to brief the model and to bound what is
 * stored. These are Hadiya's house style, not the platforms' hard limits: a
 * caption that fits is worth more than one that technically posts.
 */
export interface PlatformProfile {
  label: string;
  /** Target caption length the model is briefed with. */
  captionTargetChars: number;
  /** Hashtags that suit the platform; zero means the platform does not use them. */
  hashtagTarget: number;
  /** Content types that make sense there, for the model's benefit. */
  typicalTypes: readonly ContentType[];
}

export const PLATFORM_PROFILES: Record<ContentPlatform, PlatformProfile> = {
  instagram: {
    label: 'Instagram',
    captionTargetChars: 600,
    hashtagTarget: 8,
    typicalTypes: ['post', 'reel', 'story', 'carousel', 'product', 'promotional'],
  },
  telegram: {
    label: 'Telegram',
    captionTargetChars: 800,
    // Telegram channels read as messages; a wall of hashtags looks like spam.
    hashtagTarget: 3,
    typicalTypes: ['post', 'announcement', 'educational', 'promotional', 'product'],
  },
  tiktok: {
    label: 'TikTok',
    captionTargetChars: 150,
    hashtagTarget: 5,
    typicalTypes: ['video', 'reel', 'educational', 'promotional'],
  },
  facebook: {
    label: 'Facebook',
    captionTargetChars: 500,
    hashtagTarget: 3,
    typicalTypes: ['post', 'announcement', 'promotional', 'product', 'video'],
  },
};

export const CONTENT_PLAN_TITLE_MAX_LENGTH = 160;
export const CONTENT_PLAN_DESCRIPTION_MAX_LENGTH = 2_000;
export const CONTENT_ITEM_TITLE_MAX_LENGTH = 200;
export const CONTENT_IDEA_MAX_LENGTH = 2_000;
export const CONTENT_CAPTION_MAX_LENGTH = 4_000;
export const CONTENT_CTA_MAX_LENGTH = 300;
export const CONTENT_NOTES_MAX_LENGTH = 2_000;
export const CONTENT_HASHTAG_MAX_LENGTH = 60;
export const CONTENT_MAX_HASHTAGS = 30;

/**
 * How many items one plan may hold. A bound exists because a plan is generated
 * in a single model reply: past this the reply is unreliable long before the
 * plan is useful.
 */
export const CONTENT_PLAN_MAX_ITEMS = 60;

/** Days a generated plan may span, and the default when none is asked for. */
export const CONTENT_PLAN_MAX_DAYS = 60;
export const CONTENT_PLAN_DEFAULT_DAYS = 7;

/** Ideas one `generate_content_ideas` call may return. */
export const CONTENT_IDEAS_MAX = 20;
export const CONTENT_IDEAS_DEFAULT = 5;

/**
 * Memory keys the content engine reads (Phase 5).
 *
 * Named here so the assistant, the generator and anything that stores a
 * preference all agree on the spelling — a preference saved under a key nothing
 * reads is worse than no preference at all.
 */
export const CONTENT_PREFERENCE_KEYS = {
  language: 'content_language',
  tone: 'content_tone',
  style: 'content_style',
  platform: 'preferred_platform',
  brandVoice: 'brand_voice',
  audience: 'target_audience',
} as const;

export type ContentPreferenceKey =
  (typeof CONTENT_PREFERENCE_KEYS)[keyof typeof CONTENT_PREFERENCE_KEYS];

/** Attempts the generator makes before giving up on malformed model output. */
export const CONTENT_GENERATION_MAX_ATTEMPTS = 2;
