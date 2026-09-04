import type {
  ImageAspectRatio,
  ImageAssetStatus,
  ImageQuality,
  ImageStyle,
} from '../constants/images.js';
import type { Entity } from './entity.js';

/**
 * One generated image.
 *
 * The bytes live in storage and the row holds where; `url` is the API path that
 * serves them, not a provider link. Provider URLs expire — some within the
 * hour — so an asset that pointed at one would quietly become a broken image in
 * a plan somebody wrote weeks earlier.
 */
export interface ImageAsset extends Entity {
  /** Owner. Images are private and never visible across accounts. */
  user: string;
  /** What was asked for, exactly as it was sent. */
  prompt: string;
  /** What the provider rewrote it to, when it says. */
  revisedPrompt: string | null;
  provider: string;
  model: string | null;
  status: ImageAssetStatus;
  width: number | null;
  height: number | null;
  aspectRatio: ImageAspectRatio;
  quality: ImageQuality | null;
  style: ImageStyle | null;
  /** Opaque storage key. Never a filesystem path a client could influence. */
  storageKey: string | null;
  /** Authenticated API path that serves the bytes. */
  url: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  /** Content item this belongs to, when it was generated for one. */
  contentItem: string | null;
  /** Conversation it was asked for in, when it came from a chat. */
  conversation: string | null;
  /** Why a `failed` asset failed. Never carries a credential. */
  failureReason: string | null;
  /** Free-form context: the brief, the product it was based on. */
  metadata: Record<string, unknown>;
}

/**
 * What a generation request answers with.
 *
 * Shaped for a chat client to render directly: the assets carry their own URL,
 * prompt, status and content association, so nothing else has to be fetched to
 * show what was made.
 */
export interface ImageGenerationResult {
  images: ImageAsset[];
  /** Present when fewer images were produced than were asked for. */
  note: string | null;
}
