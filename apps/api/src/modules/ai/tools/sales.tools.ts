import { formatMoney, type SaleStatus } from '@hadiya/shared';
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

const toDay = (value: string, endOfDay: boolean): Date => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`"${value}" is not a date I can read; use YYYY-MM-DD.`);
  }

  // A bare date means the whole day, not the instant of midnight.
  if (/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    date.setHours(endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
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
      from: toDay(from, false),
      to: toDay(to, true),
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
