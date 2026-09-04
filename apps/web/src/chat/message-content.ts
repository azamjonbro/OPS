import type { Message, MessageToolCall } from '@hadiya/shared';

/**
 * What a message *is*, as far as the interface is concerned.
 *
 * A stored message is a role and some text, plus whatever tools the assistant
 * asked for. What the person should see is richer than that: an image the
 * assistant drew, a plan it wrote, a reminder it set. Rather than growing a
 * chain of `v-if`s inside the bubble, a message is translated once into a list
 * of typed blocks and each block has its own renderer.
 *
 * That is also what makes streaming tractable later: a partial reply is a
 * `text` block whose content grows, and a tool event is a `tool` block that
 * changes status — neither needs a new component or a different message shape.
 */
export type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; call: MessageToolCall }
  | { kind: 'image'; images: GeneratedImageBlock[]; call: MessageToolCall }
  | { kind: 'content-plan'; plan: ContentPlanBlock; call: MessageToolCall }
  | { kind: 'reminder'; reminder: ReminderBlock; call: MessageToolCall }
  | { kind: 'confirmation'; call: MessageToolCall; question: string }
  | { kind: 'error'; call: MessageToolCall; message: string };

export interface GeneratedImageBlock {
  id: string;
  url: string | null;
  prompt: string;
  revisedPrompt: string | null;
  status: string;
  aspectRatio: string;
  contentItemId: string | null;
}

export interface ContentPlanDay {
  day: number;
  date: string;
  contentType: string;
  title: string;
  idea: string;
  caption: string | null;
  callToAction: string | null;
  hashtags: string[];
}

export interface ContentPlanBlock {
  id: string;
  title: string;
  platform: string;
  startDate: string;
  endDate: string;
  itemCount: number;
  items: ContentPlanDay[];
}

export interface ReminderBlock {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  localScheduledAt: string;
  timezone: string;
  status: string;
  recurrenceRule: string | null;
}

/**
 * Tool names the interface renders specially.
 *
 * Everything else falls back to the generic tool card, which is the important
 * part: a tool added to the backend tomorrow shows up as a legible step rather
 * than as nothing, and no frontend release is needed to keep pace.
 */
const IMAGE_TOOLS = new Set(['generate_image']);
const PLAN_TOOLS = new Set(['create_content_plan', 'get_content_plan']);
const REMINDER_TOOLS = new Set(['create_reminder', 'update_reminder', 'get_reminder']);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Structured tool output is not delivered to the client today: the API stores a
 * tool call's *summary* text, not its `data` payload. So the renderers read
 * whatever structure is available and fall back to the summary, which is always
 * present. When the transcript starts carrying `data`, these readers pick it up
 * without the components changing.
 */
export const readImages = (call: MessageToolCall): GeneratedImageBlock[] => {
  const data = asRecord((call as { data?: unknown }).data);
  const images = Array.isArray(data?.images) ? data.images : [];

  return images.flatMap((entry) => {
    const image = asRecord(entry);
    const id = asString(image?.id);

    if (!id) {
      return [];
    }

    return [
      {
        id,
        url: asString(image?.url),
        prompt: asString(image?.prompt) ?? '',
        revisedPrompt: asString(image?.revisedPrompt),
        status: asString(image?.status) ?? 'completed',
        aspectRatio: asString(image?.aspectRatio) ?? '1:1',
        contentItemId: asString(image?.contentItemId),
      },
    ];
  });
};

export const readPlan = (call: MessageToolCall): ContentPlanBlock | null => {
  const data = asRecord((call as { data?: unknown }).data);
  const id = asString(data?.id);

  if (!id) {
    return null;
  }

  const items = Array.isArray(data?.items) ? data.items : [];

  return {
    id,
    title: asString(data?.title) ?? 'Content plan',
    platform: asString(data?.platform) ?? 'instagram',
    startDate: asString(data?.startDate) ?? '',
    endDate: asString(data?.endDate) ?? '',
    itemCount: typeof data?.itemCount === 'number' ? data.itemCount : items.length,
    items: items.flatMap((entry, index) => {
      const item = asRecord(entry);

      if (!item) {
        return [];
      }

      return [
        {
          day: typeof item.day === 'number' ? item.day : index + 1,
          date: asString(item.date) ?? '',
          contentType: asString(item.contentType) ?? 'post',
          title: asString(item.title) ?? '',
          idea: asString(item.idea) ?? '',
          caption: asString(item.caption),
          callToAction: asString(item.callToAction),
          hashtags: Array.isArray(item.hashtags)
            ? item.hashtags.filter((tag): tag is string => typeof tag === 'string')
            : [],
        },
      ];
    }),
  };
};

export const readReminder = (call: MessageToolCall): ReminderBlock | null => {
  const data = asRecord((call as { data?: unknown }).data);
  const id = asString(data?.id);

  if (!id) {
    return null;
  }

  return {
    id,
    title: asString(data?.title) ?? 'Reminder',
    description: asString(data?.description),
    scheduledAt: asString(data?.scheduledAt) ?? '',
    localScheduledAt: asString(data?.localScheduledAt) ?? '',
    timezone: asString(data?.timezone) ?? '',
    status: asString(data?.status) ?? 'scheduled',
    recurrenceRule: asString(data?.recurrenceRule),
  };
};

/** One tool call, as the block that best explains what it did. */
export const toolToBlock = (call: MessageToolCall): MessageBlock => {
  if (call.status === 'needs_confirmation') {
    return { kind: 'confirmation', call, question: call.result ?? 'Confirmation is needed.' };
  }

  if (call.status === 'failed') {
    return { kind: 'error', call, message: call.result ?? 'That step did not work.' };
  }

  if (IMAGE_TOOLS.has(call.name)) {
    const images = readImages(call);

    if (images.length > 0) {
      return { kind: 'image', images, call };
    }
  }

  if (PLAN_TOOLS.has(call.name)) {
    const plan = readPlan(call);

    if (plan) {
      return { kind: 'content-plan', plan, call };
    }
  }

  if (REMINDER_TOOLS.has(call.name)) {
    const reminder = readReminder(call);

    if (reminder) {
      return { kind: 'reminder', reminder, call };
    }
  }

  return { kind: 'tool', call };
};

/** A stored message, as the blocks that should be rendered for it. */
export const toBlocks = (message: Message): MessageBlock[] => {
  const blocks: MessageBlock[] = message.toolCalls.map(toolToBlock);

  if (message.content.trim().length > 0) {
    // Text last: the assistant's sentence is its conclusion, and it reads
    // better after the steps that produced it.
    blocks.push({ kind: 'text', text: message.content });
  }

  return blocks;
};
