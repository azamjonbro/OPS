import { formatMoney } from '@hadiya/shared';
import type { z } from 'zod';

import {
  BILLZ_CAPABILITIES,
  createBillzCapabilityRunner,
  type BillzCapabilityName,
  type BillzCapabilityRunner,
} from '../../billz/index.js';
import type { RegisteredTool } from './tool-registry.js';

/**
 * The assistant's sight of the shop, straight from Billz.
 *
 * Billz is the system of record: it owns the catalogue, the till, the stock and
 * the customer ledger. Hadiya does not keep a second copy to answer questions
 * from, because a second copy is a second version of the truth — it goes stale
 * between syncs, and a shopkeeper asking "hozir nechta qoldi?" means *now*.
 *
 * So every tool here reads Billz live, through the capability layer that module
 * already exposes. That layer is the boundary, and it is a real one:
 *
 *  - **read-only.** Billz's order and client *write* endpoints are not
 *    represented at all, so no prompt can reach them. The assistant can look at
 *    the shop; it cannot ring up a sale or edit a price.
 *  - **argument-validated.** Each capability carries its own schema, so a model
 *    that invents an argument gets a validation error rather than a call.
 *  - **bounded.** Every list caps its own size, so one question cannot pull the
 *    whole catalogue into a context window.
 *
 * The tools are generated from the capability registry rather than written out
 * one by one. That is deliberate: a capability added to the Billz module is a
 * capability the assistant gains, with no second list here to forget to update.
 */

/** Money always crosses to the model already formatted, never as minor units. */
const money = (minor: number): string => formatMoney(minor);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * One product in a line the model can actually use: what it is, what it costs
 * and how many are left. The Billz id is included because other tools take one.
 */
const describeProduct = (product: Record<string, unknown>): string => {
  const price = typeof product.retailPrice === 'number' ? money(product.retailPrice) : 'no price';
  const stock =
    typeof product.totalStock === 'number' ? `${product.totalStock} in stock` : 'stock unknown';

  return `${String(product.name)} — ${price}, ${stock} [sku ${String(product.sku)}, id ${String(product.externalId)}]`;
};

/**
 * What the *model* reads back from a call.
 *
 * Written per capability because a good summary is the difference between an
 * assistant that says "12 ta savdo, 4 800 000 so'm" and one that recites JSON
 * at the person. Anything without a case falls back to a compact description
 * rather than to nothing — a new capability is still usable on the day it lands.
 */
const summarise = (name: BillzCapabilityName, result: unknown): string => {
  if (result === null || result === undefined) {
    return 'Billz has no record matching that.';
  }

  switch (name) {
    case 'getSalesSummary': {
      const summary = result as {
        netTotal: number;
        saleCount: number;
        returnCount: number;
        outstandingDebt: number;
      };

      return [
        `${summary.saleCount} sale(s), ${summary.returnCount} return(s).`,
        `Net takings ${money(summary.netTotal)}.`,
        summary.outstandingDebt > 0
          ? `${money(summary.outstandingDebt)} of that was left on credit.`
          : 'Nothing was left on credit.',
      ].join(' ');
    }

    case 'getInventoryValuation': {
      const valuation = result as {
        totalUnits: number;
        totalValue: number;
        productCount: number;
      };

      return `${valuation.productCount} product line(s), ${valuation.totalUnits} unit(s) on the shelves, worth ${money(valuation.totalValue)} at retail.`;
    }

    case 'getPaymentBreakdown': {
      const breakdown = result as {
        rows: Array<{ paymentTypeName: string; receiptCount: number; total: number }>;
        mixedReceiptCount: number;
        mixedTotal: number;
        creditReceiptCount: number;
        creditTotal: number;
      };

      const rows = breakdown.rows
        .map(
          (row) =>
            `${row.paymentTypeName}: ${money(row.total)} over ${row.receiptCount} receipt(s)`,
        )
        .join('; ');

      return [
        rows || 'No receipts matched a payment method.',
        // Billz records no per-method split on a mixed receipt, and saying so is
        // more useful than a total that quietly under-reports every method.
        breakdown.mixedReceiptCount > 0
          ? `${breakdown.mixedReceiptCount} receipt(s) totalling ${money(breakdown.mixedTotal)} used more than one method, which Billz does not split.`
          : '',
        breakdown.creditReceiptCount > 0
          ? `${breakdown.creditReceiptCount} receipt(s) totalling ${money(breakdown.creditTotal)} were sold on credit.`
          : '',
      ]
        .filter(Boolean)
        .join(' ');
    }

    case 'getDebts': {
      const rows = result as Array<{ customerName: string | null; amount: number }>;

      if (rows.length === 0) {
        return 'Nobody owes anything for that period.';
      }

      const total = rows.reduce((sum, row) => sum + row.amount, 0);

      return `${rows.length} unpaid receipt(s), ${money(total)} owed in total. ${rows
        .slice(0, 10)
        .map((row) => `${row.customerName ?? 'Walk-in'} ${money(row.amount)}`)
        .join(', ')}.`;
    }

    case 'getInventory': {
      const levels = result as Array<{
        productName: string;
        shopName: string;
        quantity: number;
      }>;

      if (levels.length === 0) {
        return 'No stock matched that.';
      }

      return `${levels.length} stock line(s), lowest first: ${levels
        .slice(0, 20)
        .map((level) => `${level.productName} — ${level.quantity} at ${level.shopName}`)
        .join('; ')}.`;
    }

    case 'getProducts':
    case 'searchProducts': {
      const page = result as { items: Array<Record<string, unknown>>; total: number };

      if (page.items.length === 0) {
        return 'No product matched that.';
      }

      // A line per product rather than the raw objects. Those carry a price
      // array and a stock array per shop, which is a great deal of context
      // spent on a question that was usually "do we sell this, and how many?".
      return `${page.total} product(s). ${page.items.map(describeProduct).join('; ')}.`;
    }

    case 'getProduct': {
      return describeProduct(result as Record<string, unknown>);
    }

    case 'getCustomers':
    case 'searchCustomers': {
      const page = result as {
        items: Array<{ fullName: string; phone: string | null }>;
        total: number;
      };

      if (page.items.length === 0) {
        return 'No customer matched that.';
      }

      return `${page.total} customer(s). ${page.items
        .map((customer) => `${customer.fullName}${customer.phone ? ` (${customer.phone})` : ''}`)
        .join('; ')}.`;
    }

    case 'getCustomerByPhone': {
      const customer = result as { fullName: string; phone: string | null };

      return `${customer.fullName}${customer.phone ? ` (${customer.phone})` : ''}.`;
    }

    case 'getSale': {
      const sale = result as {
        type: string;
        total: number;
        customerName: string | null;
        soldAt: string | null;
        items: Array<{ name: string; quantity: number; lineTotal: number }>;
      };

      return `${sale.type} of ${money(sale.total)} to ${sale.customerName ?? 'a walk-in customer'} on ${sale.soldAt ?? 'an unknown date'}: ${sale.items
        .map((item) => `${item.name} ×${item.quantity} (${money(item.lineTotal)})`)
        .join(', ')}.`;
    }

    default: {
      // Every remaining capability answers `{ items, total }` or an array.
      const items = Array.isArray(result)
        ? result
        : isRecord(result) && Array.isArray(result.items)
          ? result.items
          : null;

      if (!items) {
        return JSON.stringify(result);
      }

      const total =
        isRecord(result) && typeof result.total === 'number' ? result.total : items.length;

      if (items.length === 0) {
        return 'Billz returned nothing for that.';
      }

      return `${total} result(s). ${JSON.stringify(items.slice(0, 25))}`;
    }
  }
};

/** `getSalesSummary` becomes `billz_get_sales_summary`. */
const toolName = (capability: BillzCapabilityName): string =>
  `billz_${capability.replace(/([a-z\d])([A-Z])/g, '$1_$2').toLowerCase()}`;

/**
 * Extra guidance the model needs that the capability's own description — which
 * was written to document an API — does not carry.
 */
const GUIDANCE: Partial<Record<BillzCapabilityName, string>> = {
  getSalesSummary:
    'Reach for this first for "bugungi savdo qanday?", "haftalik savdo", or any question about takings. Today\'s date is in your instructions; pass the same date as from and to for one day.',
  getProducts:
    'Prefer billz_search_products when the user named a product; this is the raw catalogue.',
  searchProducts:
    'Use this when the user names something the shop sells and the answer depends on the shop\'s own copy of it — its price, its stock, its exact label. Do not reach for it to illustrate a generic request: "xitoy xidli sovun chizib ber" is a drawing, not a catalogue lookup.',
  getInventory:
    'Use maxQuantity to answer "qaysi mahsulot tugayapti?" — for example maxQuantity 5 lists what is nearly out.',
  getDebts: 'Answers "kimning qarzi bor?" and "falon mijozning qarzi qancha?".',
  getCustomerByPhone:
    'Use when the user gives a full phone number; otherwise use billz_search_customers.',
};

const buildTool = (
  capability: (typeof BILLZ_CAPABILITIES)[number],
  resolve: () => BillzCapabilityRunner,
): RegisteredTool => ({
  name: toolName(capability.name),
  description: [capability.description, GUIDANCE[capability.name] ?? ''].filter(Boolean).join(' '),
  // Nothing here writes. That is a property of the capability layer, not a
  // promise made here: Billz's write endpoints have no capability at all.
  mutates: false,
  schema: capability.schema,
  execute: async (args) => {
    // The runner is resolved per call, not when the registry is built.
    // Resolving it eagerly would read the Billz credential at start-up and
    // throw `not_configured` on a deployment that has not set one — taking the
    // whole assistant down, memory and reminders included, over an integration
    // it was not being asked about. Here the failure is contained: the registry
    // turns it into one failed tool call, and the model says the shop's figures
    // are unavailable and carries on.
    const run = resolve()[capability.name] as (input: unknown) => Promise<unknown>;
    const result = await run(args as z.output<typeof capability.schema>);

    return {
      summary: summarise(capability.name, result),
      // The structured payload the chat renders as a table or a figure. The
      // model never sees this; it reads the summary above.
      data: result,
    };
  },
});

/**
 * Every Billz capability, as a tool.
 *
 * Takes a factory rather than a runner so nothing is constructed until a call
 * is actually made; tests pass their own to work against a double.
 */
export const createBillzTools = (
  resolve: () => BillzCapabilityRunner = () => createBillzCapabilityRunner(),
): RegisteredTool[] => BILLZ_CAPABILITIES.map((capability) => buildTool(capability, resolve));
