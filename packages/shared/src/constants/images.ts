/**
 * An image's lifecycle.
 *
 * `generating` exists because the row is written *before* the provider is
 * called: a request that dies mid-flight leaves visible evidence rather than
 * nothing at all, and the person can see that something was attempted. Only
 * `completed` has bytes behind it.
 */
export const IMAGE_ASSET_STATUSES = ['generating', 'completed', 'failed'] as const;

export type ImageAssetStatus = (typeof IMAGE_ASSET_STATUSES)[number];

/**
 * Shapes a person actually posts, named the way they think about them.
 *
 * A ratio rather than a pixel size, because what each model calls "landscape"
 * differs and will keep differing; the provider maps a ratio to whatever its
 * own model accepts. Adding one is a line here plus a line in each provider's
 * map — no migration, because nothing stores a provider-specific size.
 */
export const IMAGE_ASPECT_RATIOS = ['1:1', '4:5', '16:9', '9:16', '3:2'] as const;

export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number];

/** What each ratio is for, so the assistant can pick one without being told. */
export const ASPECT_RATIO_GUIDANCE: Record<ImageAspectRatio, string> = {
  '1:1': 'Square. Instagram and Facebook feed posts.',
  '4:5': 'Portrait. The tallest an Instagram feed post may be, so it fills the most screen.',
  '16:9': 'Landscape. Facebook link previews, YouTube, banners.',
  '9:16': 'Vertical. Stories, Reels and TikTok.',
  '3:2': 'Classic photo landscape.',
};

export const IMAGE_QUALITIES = ['standard', 'high'] as const;

export type ImageQuality = (typeof IMAGE_QUALITIES)[number];

/**
 * A house style, not a free-text instruction.
 *
 * The prompt already carries the subject; this is the look, and a closed list
 * keeps a plan's images consistent with each other instead of drifting with
 * whatever adjective the model reached for that day.
 */
export const IMAGE_STYLES = [
  'photo',
  'lifestyle',
  'studio',
  'illustration',
  'minimal',
  'bold',
] as const;

export type ImageStyle = (typeof IMAGE_STYLES)[number];

/** How each style is described to the model. */
export const IMAGE_STYLE_GUIDANCE: Record<ImageStyle, string> = {
  photo: 'A clean, realistic photograph with natural light.',
  lifestyle: 'A candid lifestyle photograph with people using the product in a real setting.',
  studio: 'A studio product shot on a plain seamless background with soft even lighting.',
  illustration: 'A flat vector illustration with simple shapes and a limited palette.',
  minimal: 'A minimal composition with generous negative space and one clear subject.',
  bold: 'A high-contrast, saturated composition that reads at a glance on a small screen.',
};

/**
 * Images one request may produce.
 *
 * Bounded because each one is paid for: a model that misreads "bir nechta" as
 * twenty would spend real money before anyone saw the first result.
 */
export const IMAGE_MAX_COUNT = 4;
export const IMAGE_DEFAULT_COUNT = 1;

export const IMAGE_PROMPT_MIN_LENGTH = 3;
export const IMAGE_PROMPT_MAX_LENGTH = 1_500;

/** Largest file accepted from a provider, before it is stored. */
export const IMAGE_MAX_BYTES = 12 * 1024 * 1024;

/** The only content types an asset may hold. Anything else is refused. */
export const IMAGE_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type ImageContentType = (typeof IMAGE_CONTENT_TYPES)[number];

export const IMAGE_FILE_EXTENSIONS: Record<ImageContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/** Images one content item may carry, so a plan cannot become a photo dump. */
export const IMAGE_MAX_PER_CONTENT_ITEM = 10;
