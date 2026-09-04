import type {
  ContentItemStatus,
  ContentPlanStatus,
  ContentPlatform,
  ContentTone,
  ContentType,
} from '../constants/content.js';
import type { Entity } from './entity.js';

/**
 * A campaign: a titled stretch of days on one platform.
 *
 * The items are a separate collection, not an embedded array. A plan is edited
 * one day at a time — "3-kunni o'zgartir" — and embedding would mean rewriting
 * the whole document, and re-validating the whole plan, to change one caption.
 */
export interface ContentPlan extends Entity {
  /** Owner. Plans are private and never shared across accounts. */
  user: string;
  title: string;
  description: string | null;
  platform: ContentPlatform;
  /** ISO-8601 date-time of the first day the plan covers. */
  startDate: string;
  /** ISO-8601 date-time of the last day. */
  endDate: string;
  status: ContentPlanStatus;
  /** Denormalised so a list does not need to count items per plan. */
  itemCount: number;
  /** Conversation it was created in, when it came from a chat. */
  conversation: string | null;
  /** Free-form context: the brief, the business facts it was based on. */
  metadata: Record<string, unknown>;
}

/** One scheduled piece of content. */
export interface ContentItem extends Entity {
  plan: string;
  /** Denormalised from the plan so an item can be authorised without a join. */
  user: string;
  /** ISO-8601 date-time the item is for. */
  date: string;
  /**
   * Usually the plan's platform, but stored per item so one plan can be
   * cross-posted without becoming two plans.
   */
  platform: ContentPlatform;
  contentType: ContentType;
  title: string;
  /** What the content is about, in prose — the brief for whoever shoots it. */
  idea: string;
  /** The copy itself, or `null` while the item is still only an idea. */
  caption: string | null;
  callToAction: string | null;
  /** Stored without the leading `#`, so they render however a client wants. */
  hashtags: string[];
  status: ContentItemStatus;
  notes: string | null;
  metadata: Record<string, unknown>;
}

/** A plan together with the items it holds, in date order. */
export interface ContentPlanDetail extends ContentPlan {
  items: ContentItem[];
}

/** One suggestion from `generate_content_ideas`; nothing is stored yet. */
export interface ContentIdea {
  title: string;
  idea: string;
  contentType: ContentType;
  /** Why it is worth posting — the argument, not the copy. */
  angle: string;
  hashtags: string[];
}

/** What a caption request answers with. */
export interface GeneratedCaption {
  caption: string;
  callToAction: string;
  hashtags: string[];
}

/**
 * The preferences the engine found for this user, and where each came from.
 *
 * Returned alongside generated content so a person can see why it sounds the
 * way it does — and so a wrong preference is visible rather than mysterious.
 */
export interface ContentPreferences {
  language: string | null;
  tone: ContentTone | null;
  style: string | null;
  platform: ContentPlatform | null;
  brandVoice: string | null;
  audience: string | null;
}
