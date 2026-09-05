import { describe, expect, it } from 'vitest';

import { toBlocks, toolToBlock } from '@/chat/message-content';
import { makeMessage, makeToolCall } from '@/test/factories';

/**
 * How a stored message becomes something a person can read.
 *
 * The fixtures mirror what each tool actually answers with, taken from the
 * tool's own `data` payload on the server — a renderer test that passes against
 * an invented shape is worse than no test, because it will keep passing when
 * the real thing stops working.
 */
describe('generated images', () => {
  const call = makeToolCall({
    name: 'generate_image',
    data: {
      images: [
        {
          id: 'img-1',
          url: null,
          prompt: 'A bottle of cola on a market stall',
          revisedPrompt: 'A chilled cola bottle, morning light',
          status: 'completed',
          aspectRatio: '1:1',
          contentItemId: null,
        },
      ],
      note: null,
    },
  });

  it('renders as an image block', () => {
    const block = toolToBlock(call);

    expect(block.kind).toBe('image');
    expect(block.kind === 'image' && block.images[0]?.id).toBe('img-1');
  });

  it('falls back to a plain step when no image came back', () => {
    expect(toolToBlock(makeToolCall({ name: 'generate_image', data: { images: [] } })).kind).toBe(
      'tool',
    );
  });
});

describe('content plans', () => {
  it('renders the days the assistant wrote', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'create_content_plan',
        data: {
          id: 'plan-1',
          title: '7 kunlik plan',
          platform: 'instagram',
          startDate: '2026-09-05',
          endDate: '2026-09-11',
          itemCount: 2,
          items: [
            {
              day: 1,
              date: '2026-09-05',
              contentType: 'post',
              title: 'Mahsulot posti',
              idea: 'Eng ko‘p sotilgan cola',
              caption: 'Yangi kelgan!',
              callToAction: 'Do‘konga keling',
              hashtags: ['cola', 'chegirma'],
            },
            {
              day: 2,
              date: '2026-09-06',
              contentType: 'reel',
              title: 'Reel',
              idea: 'Kunlik ish',
              caption: null,
              callToAction: null,
              hashtags: [],
            },
          ],
        },
      }),
    );

    expect(block.kind).toBe('content-plan');

    if (block.kind !== 'content-plan') {
      throw new Error('expected a content plan');
    }

    expect(block.plan.items).toHaveLength(2);
    expect(block.plan.items[0]?.hashtags).toEqual(['cola', 'chegirma']);
  });

  it('handles the plan the user dictated, where `items` is a count', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'create_content_plan',
        data: {
          id: 'plan-2',
          title: 'Qo‘lda yozilgan',
          platform: 'telegram',
          startDate: '2026-09-05',
          endDate: '2026-09-08',
          itemCount: 3,
          items: 3,
        },
      }),
    );

    expect(block.kind === 'content-plan' && block.plan.itemCount).toBe(3);
    expect(block.kind === 'content-plan' && block.plan.items).toEqual([]);
  });
});

describe('reminders', () => {
  it('renders the wall clock and the zone the server recorded', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'create_reminder',
        data: {
          id: 'rem-1',
          title: 'Omborni tekshir',
          description: null,
          scheduledAt: '2026-09-06T05:00:00.000Z',
          localScheduledAt: '2026-09-06 10:00',
          timezone: 'Asia/Tashkent',
          status: 'scheduled',
          recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
        },
      }),
    );

    expect(block.kind).toBe('reminder');
    expect(block.kind === 'reminder' && block.reminder.localScheduledAt).toBe('2026-09-06 10:00');
    expect(block.kind === 'reminder' && block.reminder.timezone).toBe('Asia/Tashkent');
  });

  it('asks rather than failing when the time was too vague to resolve', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'create_reminder',
        data: { needsClarification: true, question: 'Kechqurun soat nechada?' },
      }),
    );

    expect(block.kind).toBe('confirmation');
    expect(block.kind === 'confirmation' && block.question).toBe('Kechqurun soat nechada?');
  });
});

describe('the shop’s figures', () => {
  it('renders totals and best sellers', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'get_sales_summary',
        data: {
          from: '2026-09-05',
          to: '2026-09-05',
          saleCount: 12,
          grandTotal: 4_800_000,
          paidAmount: 4_000_000,
          outstandingAmount: 800_000,
          topProducts: [{ name: 'Cola 1L', sku: 'COLA1L', quantity: 9, total: 1_200_000 }],
        },
      }),
    );

    expect(block.kind).toBe('metrics');

    if (block.kind !== 'metrics') {
      throw new Error('expected metrics');
    }

    expect(block.metrics.period).toBe('2026-09-05 → 2026-09-05');
    expect(block.metrics.figures.map((figure) => figure.label)).toEqual([
      'Sales',
      'Total',
      'Paid',
      'Outstanding',
    ]);
    expect(block.metrics.rows[0]?.name).toBe('Cola 1L');
  });
});

describe('a tool the interface has never heard of', () => {
  it('still renders rows as a table, with the ids kept out of sight', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'search_notion',
        data: {
          items: [{ id: 'page-1', title: 'Marketing plan', updatedAt: '2026-09-01' }],
          total: 1,
        },
      }),
    );

    expect(block.kind).toBe('table');

    if (block.kind !== 'table') {
      throw new Error('expected a table');
    }

    expect(block.table.columns.map((column) => column.key)).toEqual(['title', 'updatedAt']);
    expect(block.table.rows[0]?.title).toBe('Marketing plan');
  });

  it('falls back to a named step when there is nothing structured to show', () => {
    const block = toolToBlock(makeToolCall({ name: 'search_notion', data: null }));

    expect(block.kind).toBe('tool');
  });
});

describe('failures and confirmations', () => {
  it('shows a failed call as an error, in words rather than in the upstream’s', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'billz_get_sales_summary',
        status: 'failed',
        result: 'Billz answered 405 for /v1/auth/login',
        data: null,
      }),
    );

    expect(block.kind).toBe('error');

    if (block.kind !== 'error') {
      throw new Error('expected an error block');
    }

    // The message names the step the way a successful one would be named; the
    // upstream text keeps its host and path out of it.
    expect(block.message).toBe('Reading the sales figures — that step did not work.');
    expect(block.message).not.toContain('/v1/auth/login');
    expect(block.detail).toBe('Billz answered 405 for /v1/auth/login');
  });

  it('shows a destructive call waiting for agreement as a confirmation', () => {
    const block = toolToBlock(
      makeToolCall({
        name: 'delete_content_plan',
        status: 'needs_confirmation',
        result: 'Confirmation needed: delete “7 kunlik plan”.',
      }),
    );

    expect(block.kind).toBe('confirmation');
  });
});

describe('a whole message', () => {
  it('puts the assistant’s sentence after the steps that produced it', () => {
    const blocks = toBlocks(
      makeMessage({
        content: 'Bugun 12 ta savdo bo‘ldi.',
        toolCalls: [makeToolCall({ name: 'get_sales_summary', data: { saleCount: 0 } })],
      }),
    );

    // Even a day with no sales has a figure worth showing: zero.
    expect(blocks.map((block) => block.kind)).toEqual(['metrics', 'text']);
  });

  it('renders a turn that is only tool steps, with no sentence', () => {
    const blocks = toBlocks(
      makeMessage({ content: '', toolCalls: [makeToolCall({ name: 'get_products' })] }),
    );

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('tool');
  });
});
