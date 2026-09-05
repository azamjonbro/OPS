import type { MessageToolCall } from '@hadiya/shared';
import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';

import { readAnalyticsInsights, readAnalyticsSummary, toolToBlock } from '@/chat/message-content';
import AnalyticsInsightsCard from './AnalyticsInsightsCard.vue';
import AnalyticsSummaryCard from './AnalyticsSummaryCard.vue';

/**
 * Analytics, as the chat draws it.
 *
 * The through-line of these cases is that the browser is a *renderer*: every
 * figure it shows arrives computed, and the cards are checked for showing what
 * they were given rather than for working anything out.
 */
const call = (name: string, data: unknown): MessageToolCall =>
  ({ id: 't1', name, status: 'succeeded', result: 'ok', data }) as unknown as MessageToolCall;

const summaryPayload = (overrides: Record<string, unknown> = {}) => ({
  period: {
    key: 'this_month',
    from: '2026-09-01',
    to: '2026-09-06',
    label: 'September 2026',
    days: 6,
    timezone: 'Asia/Tashkent',
  },
  metrics: {
    grossSales: 1_206_000_000,
    netSales: 1_206_000_000,
    returnsTotal: 0,
    saleCount: 42,
    returnCount: 0,
    unitsSold: 96,
    averageOrderValue: 28_714_285,
    outstandingDebt: 0,
  },
  comparison: {
    period: { label: 'the 6 day(s) before September 2026' },
    metrics: {},
    changes: [
      {
        metric: 'netSales',
        label: 'Net sales',
        current: 1_206_000_000,
        previous: 1_080_000_000,
        absoluteChange: 126_000_000,
        percentageChange: 11.67,
        direction: 'up',
        money: true,
      },
    ],
  },
  daily: [
    { date: '2026-09-01', revenue: 100, saleCount: 1 },
    { date: '2026-09-02', revenue: 200, saleCount: 2 },
    { date: '2026-09-03', revenue: 150, saleCount: 1 },
  ],
  dataQuality: { complete: true, notes: [], recordsAnalysed: 42, truncated: false },
  currency: 'UZS',
  ...overrides,
});

describe('reading an analytics payload', () => {
  it('turns a summary tool call into its own block, not a generic table', () => {
    const block = toolToBlock(call('analytics_get_summary', summaryPayload()));

    expect(block.kind).toBe('analytics-summary');
  });

  it('turns an insights call into its own block', () => {
    const block = toolToBlock(
      call('analytics_get_insights', {
        period: { label: 'September 2026' },
        insights: [
          {
            type: 'trend',
            metric: 'revenue',
            direction: 'down',
            magnitude: -12.4,
            period: 'September 2026',
            severity: 'medium',
            evidence: ['Measured across 6 day(s).'],
            confidence: 0.84,
            headline: 'revenue is trending down',
          },
        ],
        recommendations: [],
        dataQuality: { complete: true, notes: [], recordsAnalysed: 10, truncated: false },
      }),
    );

    expect(block.kind).toBe('analytics-insights');
  });

  it('falls back rather than throwing when the payload is not what it expected', () => {
    // A backend that changes shape should degrade to a legible step, never take
    // a message bubble down with it.
    expect(readAnalyticsSummary(call('analytics_get_summary', { nonsense: true }))).toBeNull();
    expect(readAnalyticsInsights(call('analytics_get_insights', {}))).toBeNull();
    expect(toolToBlock(call('analytics_get_summary', null)).kind).not.toBe('analytics-summary');
  });

  it('carries incomplete-data notes through rather than dropping them', () => {
    const summary = readAnalyticsSummary(
      call(
        'analytics_get_summary',
        summaryPayload({
          dataQuality: {
            complete: false,
            notes: ['Only the first 5000 of 20000 receipts were analysed.'],
            recordsAnalysed: 5_000,
            truncated: true,
          },
        }),
      ),
    );

    expect(summary?.incompleteNotes).toHaveLength(1);
  });
});

describe('the summary card', () => {
  const mountSummary = (payload: Record<string, unknown> = summaryPayload()) => {
    const summary = readAnalyticsSummary(call('analytics_get_summary', payload));

    if (!summary) {
      throw new Error('the payload did not read as a summary');
    }

    return mount(AnalyticsSummaryCard, { props: { summary } });
  };

  it('shows the figures it was given', () => {
    const text = mountSummary().text();

    expect(text).toContain('September 2026');
    expect(text).toContain('42');
    expect(text).toContain('11.67%');
  });

  it('renders the percentage the server computed rather than recomputing it', () => {
    // The card is handed 11.67 and prints 11.67. It must not divide anything:
    // a second implementation of the arithmetic is a second thing to keep
    // in agreement, and it would diverge the first time either changed.
    const wrapper = mountSummary(
      summaryPayload({
        comparison: {
          period: { label: 'previous' },
          metrics: {},
          changes: [
            {
              metric: 'netSales',
              label: 'Net sales',
              current: 10,
              previous: 100,
              absoluteChange: -90,
              // Deliberately not what the figures imply. The card must print
              // what it was told, which is how we know it is not calculating.
              percentageChange: 42.5,
              direction: 'up',
              money: true,
            },
          ],
        },
      }),
    );

    expect(wrapper.text()).toContain('42.5%');
  });

  it('says there is no comparable figure instead of printing an infinity', () => {
    const wrapper = mountSummary(
      summaryPayload({
        comparison: {
          period: { label: 'previous' },
          metrics: {},
          changes: [
            {
              metric: 'netSales',
              label: 'Net sales',
              current: 500,
              previous: 0,
              absoluteChange: 500,
              percentageChange: null,
              direction: 'up',
              money: true,
            },
          ],
        },
      }),
    );

    expect(wrapper.text()).toContain('no comparable figure');
    expect(wrapper.text()).not.toContain('Infinity');
    expect(wrapper.text()).not.toContain('NaN');
  });

  it('does not carry direction in colour alone', () => {
    const html = mountSummary().html();

    // An arrow and a sign as well as a tint: a red number and a green number
    // are the same number to a good proportion of readers.
    expect(html).toContain('↑');
    expect(html).toContain('+11.67%');
  });

  it('shows a partial-data warning where there is one', () => {
    const wrapper = mountSummary(
      summaryPayload({
        dataQuality: {
          complete: false,
          notes: ['Only the first 5000 of 20000 receipts were analysed.'],
          recordsAnalysed: 5_000,
          truncated: true,
        },
      }),
    );

    expect(wrapper.find('[role="note"]').exists()).toBe(true);
    expect(wrapper.text()).toContain('5000');
  });

  it('draws no sparkline for a period too short to have a shape', () => {
    const wrapper = mountSummary(
      summaryPayload({ daily: [{ date: '2026-09-01', revenue: 10, saleCount: 1 }] }),
    );

    expect(wrapper.find('svg').exists()).toBe(false);
  });

  it('hides the sparkline from assistive technology, since the figures say it already', () => {
    expect(mountSummary().find('svg').attributes('aria-hidden')).toBe('true');
  });
});

describe('the insights card', () => {
  const mountInsights = (payload: Record<string, unknown>) => {
    const report = readAnalyticsInsights(call('analytics_get_insights', payload));

    if (!report) {
      throw new Error('the payload did not read as an insight report');
    }

    return mount(AnalyticsInsightsCard, { props: { report } });
  };

  const insight = (overrides: Record<string, unknown> = {}) => ({
    type: 'trend',
    metric: 'revenue',
    direction: 'down',
    magnitude: -12.4,
    period: 'September 2026',
    severity: 'medium',
    evidence: ['Measured across 6 day(s).'],
    confidence: 0.84,
    headline: 'revenue is trending down',
    ...overrides,
  });

  it('shows each finding with the evidence behind it', () => {
    const text = mountInsights({
      period: { label: 'September 2026' },
      insights: [insight()],
      recommendations: [],
      dataQuality: { complete: true, notes: [], recordsAnalysed: 6, truncated: false },
    }).text();

    expect(text).toContain('revenue is trending down');
    // Shown, not hidden behind a toggle: a finding nobody can check is one
    // they have to take on faith.
    expect(text).toContain('Measured across 6 day(s).');
  });

  it('marks a low-confidence finding as a possibility', () => {
    const text = mountInsights({
      period: { label: 'September 2026' },
      insights: [insight({ confidence: 0.35 })],
      recommendations: [],
      dataQuality: { complete: true, notes: [], recordsAnalysed: 6, truncated: false },
    }).text();

    expect(text).toContain('This may be the case');
  });

  it('states a high-confidence finding without hedging it', () => {
    const text = mountInsights({
      period: { label: 'September 2026' },
      insights: [insight({ confidence: 0.95 })],
      recommendations: [],
      dataQuality: { complete: true, notes: [], recordsAnalysed: 6, truncated: false },
    }).text();

    expect(text).not.toContain('This may be the case');
  });

  it('names the severity rather than only tinting it', () => {
    const text = mountInsights({
      period: { label: 'September 2026' },
      insights: [insight({ severity: 'high' })],
      recommendations: [],
      dataQuality: { complete: true, notes: [], recordsAnalysed: 6, truncated: false },
    }).text();

    expect(text).toContain('high');
  });

  it('says plainly that a recommendation has not been acted on', () => {
    const text = mountInsights({
      period: { label: 'September 2026' },
      insights: [insight()],
      recommendations: [
        {
          basedOn: 'revenue is trending down',
          recommendation: 'Review what changed over this period.',
          rationale: 'Measured across 6 day(s).',
          priority: 'medium',
          confidence: 0.84,
        },
      ],
      dataQuality: { complete: true, notes: [], recordsAnalysed: 6, truncated: false },
    }).text();

    expect(text).toContain('Review what changed over this period.');
    // The card can sit beside tools that really do act, so the distinction has
    // to be on the card rather than left to the reader.
    expect(text).toContain('nothing has been changed');
  });
});
