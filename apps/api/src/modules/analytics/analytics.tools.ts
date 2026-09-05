import {
  ANALYTICS_MAX_RANKING,
  ANALYTICS_PERIODS,
  formatMoney,
  type AnalyticsPeriod,
  type AnalyticsRanking,
  type AuthenticatedUser,
} from '@hadiya/shared';
import { z } from 'zod';

import type { RegisteredTool, ToolContext } from '../ai/tools/tool-registry.js';
import type { AnalyticsDependencies } from './analytics.service.js';
import {
  comparePeriods,
  getAnomalies,
  getBranchPerformance,
  getInsights,
  getInventoryAnalysis,
  getSummary,
  getTopProducts,
} from './analytics.service.js';
import { previousPeriod, resolvePeriod, samePeriodLastYear } from './period.js';

/**
 * Analytics, as tools the existing agent can reach for.
 *
 * These are ordinary entries in the one `ToolRegistry` — no second agent, no
 * parallel orchestration. They are all reads, they are all parallel-safe, and
 * none of them can write anywhere: the whole module's access to Billz is the
 * same read-only capability runner the chat tools use.
 *
 * The descriptions are written for a model rather than for a developer, because
 * choosing between "summary" and "insights" is the decision that determines
 * whether a question costs one Billz read or four. Where a tool would otherwise
 * be reached for by mistake, the description says so plainly.
 *
 * A deliberate design point: the model never receives raw receipts. Every tool
 * returns computed figures, and the summary handed back to the model is a short
 * sentence of them. A month of a busy shop is thousands of rows, and putting
 * those in a context window would be slow, expensive and — because a model
 * asked to total a column will sometimes get it wrong — less accurate than the
 * arithmetic already done here.
 */

const money = (minor: number): string => formatMoney(minor);

const periodSchema = z.object({
  period: z
    .enum(ANALYTICS_PERIODS)
    .default('today')
    .describe('The window to analyse. Use custom with from/to for anything else.'),
  from: z.string().optional().describe('YYYY-MM-DD, required when period is custom'),
  to: z.string().optional().describe('YYYY-MM-DD, required when period is custom'),
});

/**
 * Resolves the window from the actor's own clock.
 *
 * The timezone is taken from the authenticated principal, never from an
 * argument: a model that could name the zone could shift which day "bugun"
 * means, and every figure with it.
 */
type PeriodArgs = z.output<typeof periodSchema>;

/**
 * `execute` receives the schema's output as `unknown`, because a registry that
 * holds every tool cannot be generic over each one's schema. Casting at the top
 * of a handler is the codebase's existing convention, and it is safe: the
 * registry validates against this very schema before `execute` is ever called.
 */
const periodFrom = (args: PeriodArgs, actor: AuthenticatedUser): AnalyticsPeriod =>
  resolvePeriod({
    key: args.period,
    timezone: actor.timezone,
    from: args.from,
    to: args.to,
  });

/** Every tool says what it could not see, so no answer can quietly omit a gap. */
const qualityNote = (quality: { complete: boolean; notes: string[] }): string =>
  quality.complete ? '' : ` Note: ${quality.notes.join(' ')}`;

const rankingLines = (items: AnalyticsRanking[]): string =>
  items
    .map(
      (row, index) =>
        `${index + 1}. ${row.name} — ${money(row.revenue)}, ${row.units} unit(s)${
          row.shareOfRevenue === null ? '' : `, ${row.shareOfRevenue}% of revenue`
        }`,
    )
    .join('; ');

const base = {
  mutates: false,
  category: 'business',
  risk: 'read',
  // Analysis is a read of a period, so several may run in one round: a question
  // that wants a summary and a branch ranking should wait for the slower of the
  // two rather than for their sum.
  parallelSafe: true,
} as const;

const buildSummaryTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_get_summary',
  description:
    'Headline business figures for a period: net and gross sales, sale count, average order value, units sold and outstanding debt. Set compare to true to measure the period against the equally long window before it. Reach for this first for "bugungi savdo qanday?" or "bu oy qancha sotdik?".',
  schema: periodSchema.extend({
    compare: z
      .boolean()
      .default(false)
      .describe('Also return the previous period and the change against it'),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as PeriodArgs & { compare: boolean };
    const period = periodFrom(args, context.actor);
    const result = await getSummary(context.actor, period, { compare: args.compare }, deps);
    const { metrics } = result;

    const headline = `${period.label} (${period.from} → ${period.to}): net ${money(metrics.netSales)} from ${metrics.saleCount} sale(s), average basket ${money(metrics.averageOrderValue)}, ${metrics.unitsSold} unit(s).`;

    const changes = result.comparison
      ? ` Versus ${result.comparison.period.label}: ${result.comparison.changes
          .map(
            (change) =>
              `${change.label} ${
                change.percentageChange === null
                  ? `${change.direction} (no percentage — the previous period was zero)`
                  : `${change.percentageChange > 0 ? '+' : ''}${change.percentageChange}%`
              }`,
          )
          .join(', ')}.`
      : '';

    return { summary: `${headline}${changes}${qualityNote(result.dataQuality)}`, data: result };
  },
});

const buildCompareTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_compare_periods',
  description:
    'Compares a period against another and names what accounts for the difference, product by product. Use for "nega savdo kechagidan past?" or "o\'tgan oy bilan solishtir". The contributors say where the money moved, never why it moved.',
  schema: periodSchema.extend({
    against: z
      .enum(['previous', 'last_year'])
      .default('previous')
      .describe(
        'previous compares with the equally long window immediately before; last_year with the same dates a year earlier',
      ),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as PeriodArgs & { against: 'previous' | 'last_year' };
    const current = periodFrom(args, context.actor);
    const comparison =
      args.against === 'last_year' ? samePeriodLastYear(current) : previousPeriod(current);
    const result = await comparePeriods(context.actor, current, comparison, deps);

    const changes = result.changes
      .map(
        (change) =>
          `${change.label}: ${change.money ? money(change.current) : change.current} vs ${
            change.money ? money(change.previous) : change.previous
          } (${
            change.percentageChange === null
              ? 'no percentage — the previous period was zero'
              : `${change.percentageChange > 0 ? '+' : ''}${change.percentageChange}%`
          })`,
      )
      .join('; ');

    const contributors =
      result.topContributors.length > 0
        ? ` Largest movers: ${result.topContributors
            .map(
              (contributor) =>
                `${contributor.name} ${contributor.absoluteChange > 0 ? '+' : ''}${money(contributor.absoluteChange)}${
                  contributor.shareOfChange === null
                    ? ''
                    : ` (${contributor.shareOfChange}% of the movement)`
                }`,
            )
            .join(
              ', ',
            )}. These account for the change arithmetically; they do not explain its cause.`
        : '';

    return {
      summary: `${current.label} vs ${comparison.label}. ${changes}.${contributors}${qualityNote(result.dataQuality)}`,
      data: result,
    };
  },
});

const buildTopProductsTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_get_top_products',
  description:
    'Products ranked by revenue for a period, with units sold and each one\'s share of takings. Answers "qaysi mahsulotlar yaxshi sotilyapti?". Returned lines subtract, so a product sold and brought back does not appear as a bestseller.',
  schema: periodSchema.extend({
    limit: z.number().int().min(1).max(ANALYTICS_MAX_RANKING).default(10),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as PeriodArgs & { limit: number };
    const period = periodFrom(args, context.actor);
    const result = await getTopProducts(context.actor, period, args.limit, deps);

    if (result.items.length === 0) {
      return {
        summary: `No products were sold in ${period.label}.${qualityNote(result.dataQuality)}`,
        data: result,
      };
    }

    return {
      summary: `Top products for ${period.label}: ${rankingLines(result.items)}.${qualityNote(result.dataQuality)}`,
      data: { ...result, period },
    };
  },
});

const buildBranchTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_get_branch_performance',
  description:
    'Branches (Billz shops) ranked by revenue for a period, with sale counts and share of takings. Answers "qaysi filial eng yaxshi ishlayapti?".',
  schema: periodSchema,
  execute: async (raw, context: ToolContext) => {
    const period = periodFrom(raw as PeriodArgs, context.actor);
    const result = await getBranchPerformance(context.actor, period, deps);

    if (result.items.length === 0) {
      return {
        summary: `No branch recorded a sale in ${period.label}.${qualityNote(result.dataQuality)}`,
        data: result,
      };
    }

    return {
      summary: `Branch performance for ${period.label}: ${result.items
        .map(
          (row, index) =>
            `${index + 1}. ${row.name} — ${money(row.revenue)} over ${row.saleCount} sale(s)`,
        )
        .join('; ')}.${qualityNote(result.dataQuality)}`,
      data: { ...result, period },
    };
  },
});

const buildAnomalyTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_detect_anomalies',
  description:
    'Days in a period whose takings sit far from the median of the other days. Use when asked whether anything unusual happened. It reports that a day was unusual and never why: state the coincidence, do not assert a cause.',
  schema: periodSchema,
  execute: async (raw, context: ToolContext) => {
    const period = periodFrom(raw as PeriodArgs, context.actor);
    const result = await getAnomalies(context.actor, period, deps);

    if (result.anomalies.length === 0) {
      return {
        summary: `Nothing unusual in ${period.label}: every day sits within the normal range for the period.${qualityNote(result.dataQuality)}`,
        data: result,
      };
    }

    return {
      summary: `${result.anomalies.length} unusual day(s) in ${period.label}: ${result.anomalies
        .map(
          (anomaly) =>
            `${anomaly.date} took ${money(anomaly.value)}, ${Math.abs(anomaly.deviationPercent)}% ${
              anomaly.direction === 'spike' ? 'above' : 'below'
            } the ${money(anomaly.baseline)} median`,
        )
        .join('; ')}.${qualityNote(result.dataQuality)}`,
      data: result,
    };
  },
});

const buildInsightsTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_get_insights',
  description:
    'The executive summary: what changed over a period, which days were unusual, what accounts for the movement, and what to consider looking at. Use for open questions like "bu oy biznesda nimalar o\'zgardi?" — it reads the period once and derives every finding from the same figures, so prefer it over calling summary, trends and anomalies separately. Respect each finding\'s confidence: state high-confidence findings plainly, and speak low-confidence ones as possibilities.',
  schema: periodSchema,
  execute: async (raw, context: ToolContext) => {
    const period = periodFrom(raw as PeriodArgs, context.actor);
    const result = await getInsights(context.actor, period, deps);

    const findings = result.insights
      .map(
        (insight) =>
          `[${insight.severity}, confidence ${insight.confidence}] ${insight.headline}. ${insight.evidence.join(' ')}`,
      )
      .join(' | ');

    const suggestions =
      result.recommendations.length > 0
        ? ` Worth considering: ${result.recommendations.map((entry) => entry.recommendation).join(' ')}`
        : '';

    return {
      summary: `${period.label}: ${findings || 'nothing notable to report.'}${suggestions}${qualityNote(result.dataQuality)}`,
      data: result,
    };
  },
});

const buildInventoryTool = (deps: AnalyticsDependencies): RegisteredTool => ({
  ...base,
  name: 'analytics_get_inventory_analysis',
  description:
    'Stock that is running low, and stock that is sitting still — products in stock with no sales at all in the period, ordered by the money tied up in them. Answers "nima tugayapti?" and "qaysi tovar qotib qolgan?".',
  schema: periodSchema.extend({
    lowStockThreshold: z
      .number()
      .int()
      .min(0)
      .max(1_000)
      .default(5)
      .describe('Quantity at or below which stock counts as low'),
    limit: z.number().int().min(1).max(ANALYTICS_MAX_RANKING).default(10),
  }),
  execute: async (raw, context: ToolContext) => {
    const args = raw as PeriodArgs & { lowStockThreshold: number; limit: number };
    const period = periodFrom(args, context.actor);
    const result = await getInventoryAnalysis(
      context.actor,
      period,
      { lowStockThreshold: args.lowStockThreshold, limit: args.limit },
      deps,
    );

    const low =
      result.lowStock.length > 0
        ? `Low stock: ${result.lowStock
            .map((row) => `${row.productName} — ${row.quantity} at ${row.shopName}`)
            .join('; ')}.`
        : 'Nothing is below the low-stock threshold.';

    const slow =
      result.slowMoving.length > 0
        ? ` Not moving in ${period.label}: ${result.slowMoving
            .map((row) => `${row.productName} (${row.quantity} on hand, ${money(row.stockValue)})`)
            .join('; ')}.`
        : ` Everything in stock sold at least once in ${period.label}.`;

    return { summary: `${low}${slow}${qualityNote(result.dataQuality)}`, data: result };
  },
});

/**
 * Built as a list rather than registered here, so the one registry factory in
 * `ai/tools/index.ts` stays the single place tools are assembled.
 *
 * Takes dependencies for symmetry with `createBillzTools`: passing a scripted
 * Billz runner is what lets a test drive the whole tool surface — argument
 * validation, arithmetic, wording and all — without a network.
 */
export const createAnalyticsTools = (
  dependencies: AnalyticsDependencies = {},
): RegisteredTool[] => [
  buildSummaryTool(dependencies),
  buildCompareTool(dependencies),
  buildTopProductsTool(dependencies),
  buildBranchTool(dependencies),
  buildAnomalyTool(dependencies),
  buildInsightsTool(dependencies),
  buildInventoryTool(dependencies),
];
