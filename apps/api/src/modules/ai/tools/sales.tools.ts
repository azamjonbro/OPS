import {
  formatMoney,
  parseLocalDateTime,
  zonedPartsToInstant,
  type SaleStatus,
} from '@hadiya/shared';
import { z } from 'zod';

import * as saleService from '../../sales/sale.service.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * Read-only windows onto Hadiya's own sales.
 *
 * They call the same service the REST API does, so branch scoping and every
 * other rule apply unchanged: a cashier asking the assistant sees exactly what
 * they would see through the API, and nothing here can write.
 */
const dateSchema = z
  .string()
  .trim()
  .min(4)
  .describe('ISO-8601 date, e.g. 2026-09-04. Use the same day twice for a single day.');

/**
 * A bare date means a whole day — and whose day matters.
 *
 * "Bugungi savdo" is the user's today, read on their own wall clock, so the
 * range is built in their zone rather than the server's. Those differ by hours,
 * and for a shop in Tashkent asking late in the evening the server's day has
 * already moved on: the takings of the day they are standing in would be
 * reported as belonging to tomorrow, or missing altogether.
 */
const toDay = (value: string, endOfDay: boolean, timeZone: string): Date => {
  const text = value.trim();
  const local = parseLocalDateTime(text);

  if (local && local.time === null) {
    return zonedPartsToInstant(
      {
        ...local.day,
        hour: endOfDay ? 23 : 0,
        minute: endOfDay ? 59 : 0,
        second: endOfDay ? 59 : 0,
      },
      timeZone,
    );
  }

  // Anything else is already an instant, or is not a date at all.
  const date = new Date(text);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`"${value}" is not a date I can read; use YYYY-MM-DD.`);
  }

  return date;
};

/** Bounded so one question cannot pull a year of receipts into a prompt. */
const MAX_SALES_ROWS = 200;

export const getSalesSummaryTool: RegisteredTool = {
  name: 'get_sales_summary',
  description:
    "Totals for the shop's own sales over a date range: how many receipts, how much was taken, how much is still owed, and the best-selling products. Use this for questions like today's or this month's takings.",
  mutates: false,
  schema: z.object({
    from: dateSchema,
    to: dateSchema,
    branchId: z.string().trim().length(24).optional().describe('Defaults to the user’s own branch'),
  }),
  execute: async (args, context) => {
    const { from, to, branchId } = args as { from: string; to: string; branchId?: string };

    const { items, pagination } = await saleService.listSales(context.actor, {
      page: 1,
      pageSize: MAX_SALES_ROWS,
      from: toDay(from, false, context.actor.timezone),
      to: toDay(to, true, context.actor.timezone),
      status: 'completed' as SaleStatus,
      ...(branchId ? { branchId } : {}),
    });

    const totals = items.reduce(
      (running, sale) => ({
        grandTotal: running.grandTotal + sale.totals.grandTotal,
        paid: running.paid + sale.totals.paidAmount,
        due: running.due + sale.totals.dueAmount,
      }),
      { grandTotal: 0, paid: 0, due: 0 },
    );

    const byProduct = new Map<string, { name: string; quantity: number; total: number }>();

    for (const sale of items) {
      for (const line of sale.items) {
        const entry = byProduct.get(line.sku) ?? { name: line.name, quantity: 0, total: 0 };

        entry.quantity += line.quantity;
        entry.total += line.lineTotal;
        byProduct.set(line.sku, entry);
      }
    }

    const topProducts = [...byProduct.values()]
      .sort((left, right) => right.total - left.total)
      .slice(0, 5);

    if (items.length === 0) {
      return {
        summary: `No completed sales between ${from} and ${to}.`,
        data: { saleCount: 0, from, to },
      };
    }

    return {
      // The model reads this line, so it carries formatted money rather than
      // raw minor units it would have to divide by 100 itself.
      summary: [
        `${pagination.total} sale(s) between ${from} and ${to}.`,
        `Total ${formatMoney(totals.grandTotal)}, paid ${formatMoney(totals.paid)}, outstanding ${formatMoney(totals.due)}.`,
        topProducts.length > 0
          ? `Best sellers: ${topProducts
              .map(
                (product) => `${product.name} ×${product.quantity} (${formatMoney(product.total)})`,
              )
              .join(', ')}.`
          : '',
      ]
        .filter(Boolean)
        .join(' '),
      data: {
        from,
        to,
        saleCount: pagination.total,
        grandTotal: totals.grandTotal,
        paidAmount: totals.paid,
        outstandingAmount: totals.due,
        topProducts,
      },
    };
  },
};

export const SALES_TOOLS: readonly RegisteredTool[] = [getSalesSummaryTool];
