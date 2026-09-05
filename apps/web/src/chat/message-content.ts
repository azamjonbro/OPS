import type {
  AnalyticsDailyPoint,
  AnalyticsInsight,
  AnalyticsRecommendation,
  AnalyticsSummary,
  Message,
  MessageToolCall,
  MetricComparison,
} from '@hadiya/shared';

import { toolLabel } from './tool-labels';

/**
 * What a message *is*, as far as the interface is concerned.
 *
 * A stored message is a role and some text plus whatever tools the assistant
 * asked for. What the person should see is richer: an image it drew, a plan it
 * wrote, a reminder it set, the figures it read. Rather than growing a chain of
 * `v-if`s inside the bubble, a message is translated once into a list of typed
 * blocks and each block has its own renderer.
 *
 * That is also what makes streaming tractable later: a partial reply is a
 * `text` block whose content grows and a tool event is a `tool` block that
 * changes status — neither needs a new component or a different message shape.
 */
export type MessageBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; call: MessageToolCall }
  | { kind: 'image'; images: GeneratedImageBlock[]; call: MessageToolCall }
  | { kind: 'content-plan'; plan: ContentPlanBlock; call: MessageToolCall }
  | { kind: 'reminder'; reminder: ReminderBlock; call: MessageToolCall }
  | { kind: 'metrics'; metrics: MetricsBlock; call: MessageToolCall }
  | { kind: 'analytics-summary'; summary: AnalyticsSummaryBlock; call: MessageToolCall }
  | { kind: 'analytics-insights'; report: AnalyticsInsightsBlock; call: MessageToolCall }
  | { kind: 'table'; table: TableBlock; call: MessageToolCall }
  | { kind: 'confirmation'; call: MessageToolCall; question: string }
  | { kind: 'error'; call: MessageToolCall; message: string; detail: string | null };

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

/** A figure worth showing large, in minor units as the API stores money. */
export interface MetricsFigure {
  label: string;
  value: number;
  /** Money is divided by 100 for display; a count is not. */
  money: boolean;
}

export interface MetricsBlock {
  period: string | null;
  figures: MetricsFigure[];
  rows: TableBlock['rows'];
  columns: TableBlock['columns'];
}

/**
 * A period's figures, as the card draws them.
 *
 * Every number here was computed on the server. The card formats and arranges
 * them and calculates nothing of its own — a percentage worked out in the
 * browser is a second implementation of the arithmetic, and the two will
 * disagree the first time either changes.
 */
export interface AnalyticsSummaryBlock {
  periodLabel: string;
  figures: MetricsFigure[];
  changes: MetricComparison[];
  comparisonLabel: string | null;
  daily: AnalyticsDailyPoint[];
  /** Present only when the figures are partial; shown, never hidden. */
  incompleteNotes: string[];
}

export interface AnalyticsInsightsBlock {
  periodLabel: string;
  insights: AnalyticsInsight[];
  recommendations: AnalyticsRecommendation[];
  incompleteNotes: string[];
}

export interface TableBlock {
  columns: Array<{ key: string; label: string; money: boolean }>;
  rows: Array<Record<string, string | number | null>>;
  /** How many rows exist server-side, when more than were returned. */
  total: number | null;
}

/**
 * Tool names the interface renders specially.
 *
 * Everything else falls back to the generic reader below, which is the
 * important part: a tool added to the backend tomorrow — a Notion search, a
 * supplier lookup — shows up as a legible step and, if it answers with rows, as
 * a legible table, without a frontend release to keep pace.
 */
const IMAGE_TOOLS = new Set(['generate_image']);
const PLAN_TOOLS = new Set(['create_content_plan', 'get_content_plan']);
const REMINDER_TOOLS = new Set([
  'create_reminder',
  'update_reminder',
  'get_reminder',
  'cancel_reminder',
]);
const METRIC_TOOLS = new Set(['get_sales_summary']);
const ANALYTICS_SUMMARY_TOOLS = new Set(['analytics_get_summary']);
const ANALYTICS_INSIGHT_TOOLS = new Set(['analytics_get_insights']);

/** Keys that are money in minor units wherever a tool returns them. */
const MONEY_KEYS = new Set([
  'grandTotal',
  'paidAmount',
  'outstandingAmount',
  'total',
  'price',
  'costPrice',
  'amount',
  'debtBalance',
]);

/** Internal plumbing a person should never be shown in a results table. */
const HIDDEN_KEYS = new Set(['id', 'planId', 'user', 'conversation', 'contentItemId']);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === 'number' ? value : null);

const dataOf = (call: MessageToolCall): Record<string, unknown> | null => asRecord(call.data);

/** `grandTotal` becomes `Grand total`, `contentType` becomes `Content type`. */
export const humaniseKey = (key: string): string => {
  const spaced = key.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');

  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

export const readImages = (call: MessageToolCall): GeneratedImageBlock[] => {
  const data = dataOf(call);
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
  const data = dataOf(call);
  const id = asString(data?.id);

  if (!id) {
    return null;
  }

  // `create_content_plan` answers with a day count when the user dictated the
  // days themselves, and with the days when it wrote them. Both are valid.
  const items = Array.isArray(data?.items) ? data.items : [];

  return {
    id,
    title: asString(data?.title) ?? 'Content plan',
    platform: asString(data?.platform) ?? 'instagram',
    startDate: asString(data?.startDate) ?? '',
    endDate: asString(data?.endDate) ?? '',
    itemCount: asNumber(data?.itemCount) ?? (asNumber(data?.items) || items.length),
    items: items.flatMap((entry, index) => {
      const item = asRecord(entry);

      if (!item) {
        return [];
      }

      return [
        {
          day: asNumber(item.day) ?? index + 1,
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
  const data = dataOf(call);
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

/**
 * Rows from a tool that answered with a list.
 *
 * Columns come from the rows rather than from a hard-coded schema, so a tool
 * the frontend has never heard of still renders as a table instead of as a
 * paragraph of JSON. Ids are dropped: they are the server's business, and a
 * column of hex strings makes a table unreadable.
 */
export const readTable = (call: MessageToolCall): TableBlock | null => {
  const data = dataOf(call);
  const items = Array.isArray(data?.items) ? data.items : [];
  const rows = items.flatMap((entry) => {
    const item = asRecord(entry);

    if (!item) {
      return [];
    }

    const row: Record<string, string | number | null> = {};

    for (const [key, value] of Object.entries(item)) {
      if (HIDDEN_KEYS.has(key)) {
        continue;
      }

      if (value === null || typeof value === 'string' || typeof value === 'number') {
        row[key] = value;
      } else if (Array.isArray(value)) {
        row[key] = value.filter((entry) => typeof entry === 'string').join(', ');
      }
    }

    return Object.keys(row).length > 0 ? [row] : [];
  });

  if (rows.length === 0) {
    return null;
  }

  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];

  return {
    columns: keys.map((key) => ({ key, label: humaniseKey(key), money: MONEY_KEYS.has(key) })),
    rows,
    total: asNumber(data?.total),
  };
};

/** The shop's own figures, as headline numbers plus the best sellers. */
export const readMetrics = (call: MessageToolCall): MetricsBlock | null => {
  const data = dataOf(call);

  if (!data) {
    return null;
  }

  const figures: MetricsFigure[] = [
    { key: 'saleCount', label: 'Sales', money: false },
    { key: 'grandTotal', label: 'Total', money: true },
    { key: 'paidAmount', label: 'Paid', money: true },
    { key: 'outstandingAmount', label: 'Outstanding', money: true },
  ].flatMap((figure) => {
    const value = asNumber(data[figure.key]);

    return value === null ? [] : [{ label: figure.label, value, money: figure.money }];
  });

  if (figures.length === 0) {
    return null;
  }

  const products = Array.isArray(data.topProducts) ? data.topProducts : [];
  const rows = products.flatMap((entry) => {
    const product = asRecord(entry);

    return product
      ? [
          {
            name: asString(product.name) ?? asString(product.sku) ?? '—',
            quantity: asNumber(product.quantity) ?? 0,
            total: asNumber(product.total) ?? 0,
          },
        ]
      : [];
  });

  const from = asString(data.from);
  const to = asString(data.to);

  return {
    period: from && to ? `${from} → ${to}` : null,
    figures,
    columns: [
      { key: 'name', label: 'Product', money: false },
      { key: 'quantity', label: 'Sold', money: false },
      { key: 'total', label: 'Total', money: true },
    ],
    rows,
  };
};

/**
 * The headline figures a summary tool returned.
 *
 * Reads defensively: every field is checked rather than trusted, so a tool
 * whose payload changes shape degrades to the generic renderer instead of
 * throwing inside a message bubble.
 */
export const readAnalyticsSummary = (call: MessageToolCall): AnalyticsSummaryBlock | null => {
  const data = dataOf(call) as unknown as AnalyticsSummary | null;
  const metrics = asRecord(data?.metrics);
  const period = asRecord(data?.period);

  if (!metrics || !period) {
    return null;
  }

  const figures: MetricsFigure[] = [
    { key: 'netSales', label: 'Net sales', money: true },
    { key: 'saleCount', label: 'Sales', money: false },
    { key: 'averageOrderValue', label: 'Average basket', money: true },
    { key: 'unitsSold', label: 'Units', money: false },
  ].flatMap((figure) => {
    const value = asNumber(metrics[figure.key]);

    return value === null ? [] : [{ label: figure.label, value, money: figure.money }];
  });

  if (figures.length === 0) {
    return null;
  }

  const daily = Array.isArray(data?.daily)
    ? data.daily.filter(
        (point): point is AnalyticsDailyPoint =>
          asRecord(point) !== null && typeof (point as AnalyticsDailyPoint).date === 'string',
      )
    : [];

  return {
    periodLabel: asString(period.label) ?? '',
    figures,
    changes: Array.isArray(data?.comparison?.changes) ? data.comparison.changes : [],
    comparisonLabel: asString(asRecord(data?.comparison?.period)?.label),
    daily,
    // Surfaced rather than swallowed: a partial figure that looks complete is
    // the one analytics failure a person cannot detect for themselves.
    incompleteNotes: data?.dataQuality?.complete === false ? (data.dataQuality.notes ?? []) : [],
  };
};

/** Findings and suggestions, already ranked and scored by the server. */
export const readAnalyticsInsights = (call: MessageToolCall): AnalyticsInsightsBlock | null => {
  const data = dataOf(call);
  const insights = Array.isArray(data?.insights) ? (data.insights as AnalyticsInsight[]) : [];

  if (insights.length === 0) {
    return null;
  }

  const quality = asRecord(data?.dataQuality);

  return {
    periodLabel: asString(asRecord(data?.period)?.label) ?? '',
    insights: insights.filter((insight) => typeof insight?.headline === 'string'),
    recommendations: Array.isArray(data?.recommendations)
      ? (data.recommendations as AnalyticsRecommendation[])
      : [],
    incompleteNotes:
      quality?.complete === false && Array.isArray(quality.notes)
        ? (quality.notes as string[])
        : [],
  };
};

/** One tool call, as the block that best explains what it did. */
export const toolToBlock = (call: MessageToolCall): MessageBlock => {
  if (call.status === 'needs_confirmation') {
    return { kind: 'confirmation', call, question: call.result ?? 'Confirmation is needed.' };
  }

  if (call.status === 'failed') {
    // The upstream message is written for whoever reads the logs: it can name a
    // host, a path or a status code, none of which helps a shopkeeper and some
    // of which should not be on their screen at all. So the card says which
    // step failed, in the same words the successful one would have used, and
    // the raw text is tucked behind a details toggle for whoever wants it.
    return {
      kind: 'error',
      call,
      message: `${toolLabel(call.name).running} — that step did not work.`,
      detail: call.result,
    };
  }

  const data = dataOf(call);

  // A tool that answered with a question rather than a result: the assistant is
  // meant to ask, so it reads as a prompt and not as a failure.
  if (data?.needsClarification === true) {
    return {
      kind: 'confirmation',
      call,
      question: asString(data.question) ?? 'One more detail is needed.',
    };
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

  if (ANALYTICS_SUMMARY_TOOLS.has(call.name)) {
    const summary = readAnalyticsSummary(call);

    if (summary) {
      return { kind: 'analytics-summary', summary, call };
    }
  }

  if (ANALYTICS_INSIGHT_TOOLS.has(call.name)) {
    const report = readAnalyticsInsights(call);

    if (report) {
      return { kind: 'analytics-insights', report, call };
    }
  }

  if (METRIC_TOOLS.has(call.name)) {
    const metrics = readMetrics(call);

    if (metrics) {
      return { kind: 'metrics', metrics, call };
    }
  }

  const table = readTable(call);

  if (table) {
    return { kind: 'table', table, call };
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
