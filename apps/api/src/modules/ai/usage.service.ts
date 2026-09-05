import { hasAtLeastRole, type AiUsageReport, type AuthenticatedUser } from '@hadiya/shared';

import { toObjectId } from '../../core/db/object-id.js';
import { ConversationModel } from '../conversations/conversation.model.js';
import { MessageModel } from '../conversations/message.model.js';
import { ImageAssetModel } from '../images/image-asset.model.js';

/**
 * What the assistant has actually cost, from Hadiya's own records.
 *
 * Every assistant turn already stores the token counts the provider reported,
 * so this is a read of something true rather than an estimate. It is the only
 * spend figure this application can honestly produce: OpenAI does not let an
 * ordinary project key read a balance — that needs an admin key with
 * `api.usage.read`, or the billing page in a browser — so no amount of code
 * here could show one, and pretending otherwise would be worse than the gap.
 *
 * Deliberately no money. The rate depends on the plan, the model version and
 * the date, none of which this server knows; multiplying by a hard-coded price
 * would produce a confident number that is quietly wrong.
 */
const ORGANISATION_ROLE = 'manager' as const;

interface UsageTotals {
  turns: number;
  promptTokens: number;
  completionTokens: number;
  firstAt: string | null;
  lastAt: string | null;
}

const EMPTY: UsageTotals = {
  turns: 0,
  promptTokens: 0,
  completionTokens: 0,
  firstAt: null,
  lastAt: null,
};

interface AggregateRow {
  turns: number;
  promptTokens: number | null;
  completionTokens: number | null;
  firstAt: Date | null;
  lastAt: Date | null;
}

const totalsFor = async (filter: Record<string, unknown>): Promise<UsageTotals> => {
  const [row] = await MessageModel.aggregate<AggregateRow>([
    // Only assistant turns carry usage; a user's own message costs nothing and
    // a tool result was never sent to the model on its own.
    { $match: { ...filter, 'usage.promptTokens': { $ne: null } } },
    {
      $group: {
        _id: null,
        turns: { $sum: 1 },
        promptTokens: { $sum: '$usage.promptTokens' },
        completionTokens: { $sum: '$usage.completionTokens' },
        firstAt: { $min: '$createdAt' },
        lastAt: { $max: '$createdAt' },
      },
    },
  ]).exec();

  if (!row) {
    return EMPTY;
  }

  return {
    turns: row.turns,
    promptTokens: row.promptTokens ?? 0,
    completionTokens: row.completionTokens ?? 0,
    firstAt: row.firstAt?.toISOString() ?? null,
    lastAt: row.lastAt?.toISOString() ?? null,
  };
};

const byModelFor = async (filter: Record<string, unknown>): Promise<AiUsageReport['byModel']> => {
  const rows = await MessageModel.aggregate<{
    _id: string;
    turns: number;
    promptTokens: number | null;
    completionTokens: number | null;
  }>([
    { $match: { ...filter, model: { $ne: null } } },
    {
      $group: {
        _id: '$model',
        turns: { $sum: 1 },
        promptTokens: { $sum: '$usage.promptTokens' },
        completionTokens: { $sum: '$usage.completionTokens' },
      },
    },
    { $sort: { turns: -1 } },
  ]).exec();

  return rows.map((row) => ({
    model: row._id,
    turns: row.turns,
    promptTokens: row.promptTokens ?? 0,
    completionTokens: row.completionTokens ?? 0,
  }));
};

/**
 * The signed-in employee's usage, and the organisation's when their role allows
 * it.
 *
 * The organisation block is counts only — turns and tokens. Conversations are
 * private to the person who had them and this does not widen that by a word:
 * a total says how much was spent, never what anybody asked.
 */
export const getUsage = async (actor: AuthenticatedUser): Promise<AiUsageReport> => {
  const own = { user: toObjectId(actor.id) };

  const [totals, byModel, conversations, images] = await Promise.all([
    totalsFor(own),
    byModelFor(own),
    ConversationModel.countDocuments(own).exec(),
    ImageAssetModel.countDocuments(own).exec(),
  ]);

  const report: AiUsageReport = {
    scope: 'own',
    totals,
    byModel,
    conversationCount: conversations,
    imageCount: images,
    organisation: null,
  };

  if (!hasAtLeastRole(actor.role, ORGANISATION_ROLE)) {
    return report;
  }

  const [organisationTotals, organisationConversations, organisationImages] = await Promise.all([
    totalsFor({}),
    ConversationModel.countDocuments().exec(),
    ImageAssetModel.countDocuments().exec(),
  ]);

  return {
    ...report,
    organisation: {
      totals: organisationTotals,
      conversationCount: organisationConversations,
      imageCount: organisationImages,
    },
  };
};
