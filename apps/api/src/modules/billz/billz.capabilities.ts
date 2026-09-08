import { z } from 'zod';

import { getBillzServices, type BillzServices } from './services/index.js';
import type {
  BillzCategory,
  BillzCustomer,
  BillzInventoryLevel,
  BillzPaymentType,
  BillzProduct,
  BillzSale,
  BillzShop,
} from './billz.types.js';
import type { BillzDebtRow, BillzPaymentBreakdown } from './services/billz-finance.service.js';
import type { BillzSalesSummary } from './services/billz-sales.service.js';

/**
 * The safe, named things Billz can be asked for.
 *
 * This is the surface the AI agent gets in the next phase, and it is
 * deliberately narrower than the service layer:
 *
 *  - **read-only.** Nothing here writes to Billz or to Hadiya. Billz's order
 *    and client write endpoints are not represented at all, so no prompt can
 *    reach them.
 *  - **argument-validated.** Every capability carries a Zod schema, so a model
 *    that hallucinates an argument gets a validation error instead of a call.
 *  - **bounded.** Every list capability caps its own result size, so one
 *    question cannot pull the whole catalogue into a context window.
 *
 * Each entry also carries a description written for a model rather than for a
 * developer: it says what the data means and when to reach for it.
 */
/**
 * A calendar day the model wrote, checked before it becomes an outbound call.
 *
 * `z.string().min(4)` accepted anything four characters long — `"oxirgi hafta"`,
 * `"2026-02-30"`, `"soon"` — and forwarded it to Billz, which answered `400`.
 * That is the wrong place for the refusal in three ways: it spends a request on
 * a third party for input that is knowably wrong, it turns a fixable mistake
 * into an upstream outage as far as the model can tell, and the HTTP routes
 * have validated the very same field properly all along. A model is the less
 * trustworthy of the two callers, so it should not be the one held to the
 * looser rule.
 *
 * The `Date` round-trip is what rejects 31 February, which the pattern alone
 * would wave through.
 */
const dateSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a calendar date in the form 2026-09-01')
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const parsed = new Date(Date.UTC(year, month - 1, day));

    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() + 1 === month &&
      parsed.getUTCDate() === day
    );
  }, 'That is not a real calendar date')
  .describe('ISO-8601 date, e.g. 2026-09-01');

/**
 * A window may not run backwards — the same rule the HTTP routes already apply.
 * Billz answers `400` for a reversed range, so without this the model learns
 * only that the integration failed.
 */
const isForwards = (value: { from: string; to: string }): boolean => value.from <= value.to;
const BACKWARDS_RANGE = '`from` must not be after `to`';

const limitSchema = (max: number, fallback: number) =>
  z.number().int().min(1).max(max).default(fallback);

export const billzCapabilitySchemas = {
  getProducts: z.object({
    limit: limitSchema(100, 25),
    page: z.number().int().min(1).default(1),
  }),
  searchProducts: z.object({
    query: z.string().trim().min(1).max(80).describe('Name, SKU or barcode fragment'),
    limit: limitSchema(50, 20),
  }),
  getProduct: z.object({
    productId: z.string().trim().min(1).describe('The Billz product id'),
  }),
  getCategories: z.object({}),
  getShops: z.object({}),
  getPaymentTypes: z.object({}),
  getCustomers: z.object({
    limit: limitSchema(100, 25),
    page: z.number().int().min(1).default(1),
  }),
  searchCustomers: z.object({
    query: z.string().trim().min(1).max(80).describe('Name or phone fragment'),
    limit: limitSchema(50, 20),
  }),
  getCustomerByPhone: z.object({
    phone: z.string().trim().min(4).max(32),
  }),
  getSales: z
    .object({ from: dateSchema, to: dateSchema, limit: limitSchema(1_000, 200) })
    .refine(isForwards, BACKWARDS_RANGE),
  getSale: z.object({
    saleId: z.string().trim().min(1).describe('The Billz order id'),
  }),
  getSalesSummary: z
    .object({ from: dateSchema, to: dateSchema })
    .refine(isForwards, BACKWARDS_RANGE),
  getPaymentBreakdown: z
    .object({ from: dateSchema, to: dateSchema })
    .refine(isForwards, BACKWARDS_RANGE),
  getDebts: z.object({ from: dateSchema, to: dateSchema }).refine(isForwards, BACKWARDS_RANGE),
  getInventory: z.object({
    shopId: z.string().trim().min(1).optional(),
    maxQuantity: z.number().min(0).optional().describe('Only stock at or below this level'),
  }),
  getInventoryValuation: z.object({ shopId: z.string().trim().min(1).optional() }),
} as const;

export type BillzCapabilityName = keyof typeof billzCapabilitySchemas;

export interface BillzCapabilityDescriptor {
  name: BillzCapabilityName;
  /** Written for a model: what it returns and when to use it. */
  description: string;
  schema: (typeof billzCapabilitySchemas)[BillzCapabilityName];
}

export const BILLZ_CAPABILITIES: readonly BillzCapabilityDescriptor[] = [
  {
    name: 'getProducts',
    description: 'A page of the Billz catalogue with prices and stock per shop.',
    schema: billzCapabilitySchemas.getProducts,
  },
  {
    name: 'searchProducts',
    description: 'Find catalogue products by name, SKU or barcode.',
    schema: billzCapabilitySchemas.searchProducts,
  },
  {
    name: 'getProduct',
    description: 'One product by its Billz id, with prices and per-shop stock.',
    schema: billzCapabilitySchemas.getProduct,
  },
  {
    name: 'getCategories',
    description: 'The Billz category tree, with how many products each holds.',
    schema: billzCapabilitySchemas.getCategories,
  },
  {
    name: 'getShops',
    description:
      'The Billz shops this deployment reports on. Other shops on the same Billz account are out of scope and never appear.',
    schema: billzCapabilitySchemas.getShops,
  },
  {
    name: 'getPaymentTypes',
    description: 'Payment methods the company accepts, e.g. cash, card, Payme.',
    schema: billzCapabilitySchemas.getPaymentTypes,
  },
  {
    name: 'getCustomers',
    description: 'A page of customers registered in Billz.',
    schema: billzCapabilitySchemas.getCustomers,
  },
  {
    name: 'searchCustomers',
    description: 'Find a Billz customer by name or phone fragment.',
    schema: billzCapabilitySchemas.searchCustomers,
  },
  {
    name: 'getCustomerByPhone',
    description: 'Look one customer up by their exact phone number.',
    schema: billzCapabilitySchemas.getCustomerByPhone,
  },
  {
    name: 'getSales',
    description:
      'Receipts for a date range, each with its line items. Returns appear as their own receipts with a negative total.',
    schema: billzCapabilitySchemas.getSales,
  },
  {
    name: 'getSale',
    description: 'One receipt in full, by its Billz order id.',
    schema: billzCapabilitySchemas.getSale,
  },
  {
    name: 'getSalesSummary',
    description:
      'Totals for a date range: net takings, how many sales and returns, and how much was left on credit.',
    schema: billzCapabilitySchemas.getSalesSummary,
  },
  {
    name: 'getPaymentBreakdown',
    description:
      'How a period’s takings split across payment methods. Receipts settled with more than one method are reported separately, because Billz does not record how much each method covered.',
    schema: billzCapabilitySchemas.getPaymentBreakdown,
  },
  {
    name: 'getDebts',
    description: 'Receipts left unpaid in a date range, with who owes what.',
    schema: billzCapabilitySchemas.getDebts,
  },
  {
    name: 'getInventory',
    description: 'Stock on hand per product per shop, lowest first.',
    schema: billzCapabilitySchemas.getInventory,
  },
  {
    name: 'getInventoryValuation',
    description: 'Total units and retail value of everything on the shelves.',
    schema: billzCapabilitySchemas.getInventoryValuation,
  },
] as const;

export interface BillzCapabilityResults {
  getProducts: { items: BillzProduct[]; total: number };
  searchProducts: { items: BillzProduct[]; total: number };
  getProduct: BillzProduct | null;
  getCategories: { items: BillzCategory[]; total: number };
  getShops: { items: BillzShop[]; total: number };
  getPaymentTypes: { items: BillzPaymentType[]; total: number };
  getCustomers: { items: BillzCustomer[]; total: number };
  searchCustomers: { items: BillzCustomer[]; total: number };
  getCustomerByPhone: BillzCustomer | null;
  getSales: { items: BillzSale[]; total: number };
  getSale: BillzSale;
  getSalesSummary: BillzSalesSummary;
  getPaymentBreakdown: BillzPaymentBreakdown;
  getDebts: BillzDebtRow[];
  getInventory: BillzInventoryLevel[];
  getInventoryValuation: Awaited<ReturnType<BillzServices['inventory']['valuation']>>;
}

/**
 * Runs one capability with already-validated arguments.
 *
 * Phase 4 wires a model to this by validating its arguments with the matching
 * schema and calling here — it never reaches past this function into a service.
 */
export const createBillzCapabilityRunner = (services: BillzServices = getBillzServices()) => ({
  getProducts: (args: z.output<typeof billzCapabilitySchemas.getProducts>) =>
    services.catalog.listProducts(args),
  searchProducts: (args: z.output<typeof billzCapabilitySchemas.searchProducts>) =>
    services.catalog.searchProducts(args.query, args.limit),
  getProduct: (args: z.output<typeof billzCapabilitySchemas.getProduct>) =>
    services.catalog.findProduct(args.productId),
  getCategories: () => services.catalog.listCategories(),
  getShops: () => services.directory.listShops(),
  getPaymentTypes: () => services.directory.listPaymentTypes(),
  getCustomers: (args: z.output<typeof billzCapabilitySchemas.getCustomers>) =>
    services.customers.listCustomers(args),
  searchCustomers: (args: z.output<typeof billzCapabilitySchemas.searchCustomers>) =>
    services.customers.searchCustomers(args.query, args.limit),
  getCustomerByPhone: (args: z.output<typeof billzCapabilitySchemas.getCustomerByPhone>) =>
    services.customers.findByPhone(args.phone),
  getSales: (args: z.output<typeof billzCapabilitySchemas.getSales>) =>
    services.sales.listSales({ from: args.from, to: args.to, maxItems: args.limit }),
  getSale: (args: z.output<typeof billzCapabilitySchemas.getSale>) =>
    services.sales.getSale(args.saleId),
  getSalesSummary: async (args: z.output<typeof billzCapabilitySchemas.getSalesSummary>) => {
    const { items } = await services.sales.listSales({ from: args.from, to: args.to });

    return services.sales.summarise(items);
  },
  getPaymentBreakdown: (args: z.output<typeof billzCapabilitySchemas.getPaymentBreakdown>) =>
    services.finance.paymentBreakdown({ from: args.from, to: args.to }),
  getDebts: (args: z.output<typeof billzCapabilitySchemas.getDebts>) =>
    services.finance.listDebts({ from: args.from, to: args.to }),
  getInventory: (args: z.output<typeof billzCapabilitySchemas.getInventory>) =>
    services.inventory.listStock(args),
  getInventoryValuation: (args: z.output<typeof billzCapabilitySchemas.getInventoryValuation>) =>
    services.inventory.valuation(args.shopId),
});

export type BillzCapabilityRunner = ReturnType<typeof createBillzCapabilityRunner>;
