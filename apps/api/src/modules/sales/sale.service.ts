import {
  buildPaginationMeta,
  resolvePagination,
  resolveSalePaymentStatus,
  type AuthenticatedUser,
  type PaginatedResult,
} from '@hadiya/shared';
import type { ClientSession } from 'mongoose';

import { toObjectId, toObjectIdOrNull } from '../../core/db/object-id.js';
import { runInTransaction } from '../../core/db/transaction.js';
import { ApiError } from '../../core/http/api-error.js';
import {
  assertBranchAccess,
  assertRole,
  canAccessAllBranches,
  requireActorBranch,
  resolveBranchForWrite,
} from '../../core/security/actor.js';
import { branchRepository } from '../branches/branch.repository.js';
import { customerRepository } from '../customers/customer.repository.js';
import { recordMovement } from '../inventory/inventory.service.js';
import { createPaymentRecord } from '../payments/payment.service.js';
import { PaymentModel } from '../payments/payment.model.js';
import { productRepository } from '../products/product.repository.js';
import { nextSaleNumber } from './sale-number.js';
import { SaleModel, type SaleDocument, type SaleItemSubdocument } from './sale.model.js';
import type { CreateSaleInput, ListSalesQuery } from './sale.validators.js';

/** Anyone who can work a till may ring up a sale. */
const SELL_ROLE = 'cashier' as const;
/** Cancelling reverses stock and money, so it needs a supervisor. */
const CANCEL_ROLE = 'manager' as const;

/** Receipt numbers are allocated optimistically; a clash is simply retried. */
const NUMBER_RETRY_LIMIT = 5;
const DUPLICATE_KEY_CODE = 11_000;

const isDuplicateKeyError = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  (error as { code?: unknown }).code === DUPLICATE_KEY_CODE;

interface PricedSale {
  items: SaleItemSubdocument[];
  subtotal: number;
  discountTotal: number;
  grandTotal: number;
  /** Product ids whose stock this sale consumes; services are not in here. */
  trackedProductIds: Set<string>;
}

/**
 * Turns the requested lines into priced ones using the live product records.
 * Prices, names and SKUs are read here and never taken from the request.
 */
const priceItems = async (input: CreateSaleInput): Promise<PricedSale> => {
  const productIds = [...new Set(input.items.map((item) => item.productId))];
  const products = await productRepository.findManyByIds(productIds);
  const byId = new Map(products.map((product) => [String(product._id), product]));

  const items: SaleItemSubdocument[] = [];
  const trackedProductIds = new Set<string>();
  let subtotal = 0;
  let discountTotal = 0;

  for (const line of input.items) {
    const product = byId.get(line.productId);

    if (!product) {
      throw ApiError.badRequest(`Product ${line.productId} does not exist`);
    }

    if (!product.isActive) {
      throw ApiError.badRequest(`"${product.name}" is no longer for sale`);
    }

    // Money stays in integer minor units: round the line, never the total.
    const lineSubtotal = Math.round(product.price * line.quantity);
    const discount = line.discount ?? 0;

    if (discount > lineSubtotal) {
      throw ApiError.badRequest(`The discount on "${product.name}" exceeds the line total`);
    }

    items.push({
      product: product._id,
      name: product.name,
      sku: product.sku,
      unitPrice: product.price,
      costPrice: product.costPrice,
      quantity: line.quantity,
      discount,
      lineTotal: lineSubtotal - discount,
    });

    if (product.trackInventory) {
      trackedProductIds.add(String(product._id));
    }

    subtotal += lineSubtotal;
    discountTotal += discount;
  }

  return {
    items,
    subtotal,
    discountTotal,
    grandTotal: subtotal - discountTotal,
    trackedProductIds,
  };
};

/**
 * Rings up a sale.
 *
 * The receipt, the stock it consumes, the payments taken and any debt it leaves
 * behind are written in one transaction: a sale can never exist without having
 * moved the stock, and stock can never be taken without a receipt to show for it.
 */
export const createSale = async (
  actor: AuthenticatedUser,
  input: CreateSaleInput,
): Promise<SaleDocument> => {
  assertRole(actor, SELL_ROLE);

  const branchId = resolveBranchForWrite(actor, input.branchId ?? null);
  const branch = await branchRepository.findById(branchId);

  if (!branch || !branch.isActive) {
    throw ApiError.badRequest('The branch does not exist or is not active');
  }

  if (input.customerId) {
    const customer = await customerRepository.findById(input.customerId);

    if (!customer) {
      throw ApiError.badRequest('The customer does not exist');
    }

    if (customer.status === 'blocked') {
      throw ApiError.conflict('This customer is blocked and cannot be sold to');
    }
  }

  const priced = await priceItems(input);
  const paidAmount = (input.payments ?? []).reduce((total, payment) => total + payment.amount, 0);

  if (paidAmount > priced.grandTotal) {
    throw ApiError.badRequest('The payments taken exceed the sale total');
  }

  const dueAmount = priced.grandTotal - paidAmount;

  // Unpaid balances have to belong to someone who can be asked to settle them.
  if (dueAmount > 0 && !input.customerId) {
    throw ApiError.badRequest('A sale left partly unpaid must be attached to a customer');
  }

  const soldAt = input.soldAt ?? new Date();

  const write = async (session: ClientSession | undefined): Promise<SaleDocument> => {
    const [created] = await SaleModel.create(
      [
        {
          number: await nextSaleNumber(branch.code, branchId, soldAt, session),
          branch: toObjectId(branchId),
          employee: toObjectId(actor.id),
          customer: toObjectIdOrNull(input.customerId),
          items: priced.items,
          totals: {
            subtotal: priced.subtotal,
            discountTotal: priced.discountTotal,
            grandTotal: priced.grandTotal,
            paidAmount,
            dueAmount,
          },
          status: 'completed',
          paymentStatus: resolveSalePaymentStatus(priced.grandTotal, paidAmount),
          note: input.note ?? null,
          soldAt,
          cancelledAt: null,
        },
      ],
      { session },
    );

    if (!created) {
      throw ApiError.internal('The sale could not be recorded');
    }

    const sale = created.toObject<SaleDocument>();
    const saleId = String(sale._id);

    for (const item of priced.items) {
      // Services and other untracked products leave stock alone.
      if (!priced.trackedProductIds.has(String(item.product))) {
        continue;
      }

      await recordMovement({
        actorId: actor.id,
        productId: String(item.product),
        branchId,
        type: 'sale',
        quantity: item.quantity,
        reference: { kind: 'sale', id: saleId },
        occurredAt: soldAt,
        session,
      });
    }

    for (const payment of input.payments ?? []) {
      await createPaymentRecord({
        branchId,
        saleId,
        customerId: input.customerId ?? null,
        amount: payment.amount,
        method: payment.method,
        reference: payment.reference ?? null,
        receivedById: actor.id,
        paidAt: soldAt,
        session,
      });
    }

    if (dueAmount > 0 && input.customerId) {
      await customerRepository.adjustDebt(input.customerId, dueAmount, session);
    }

    return sale;
  };

  for (let attempt = 1; attempt <= NUMBER_RETRY_LIMIT; attempt += 1) {
    try {
      return await runInTransaction(write);
    } catch (error) {
      // Two tills allocated the same receipt number; the index caught it.
      if (!isDuplicateKeyError(error) || attempt === NUMBER_RETRY_LIMIT) {
        throw error;
      }
    }
  }

  throw ApiError.conflict('Could not allocate a receipt number, please retry');
};

export const getSale = async (actor: AuthenticatedUser, id: string): Promise<SaleDocument> => {
  const sale = await SaleModel.findById(id).lean<SaleDocument | null>().exec();

  if (!sale) {
    throw ApiError.notFound('Sale not found');
  }

  assertBranchAccess(actor, String(sale.branch));

  return sale;
};

export const listSales = async (
  actor: AuthenticatedUser,
  query: ListSalesQuery,
): Promise<PaginatedResult<SaleDocument>> => {
  const filter: Record<string, unknown> = {};

  if (canAccessAllBranches(actor)) {
    if (query.branchId) {
      filter.branch = query.branchId;
    }
  } else {
    filter.branch = requireActorBranch(actor);
  }

  for (const [key, value] of [
    ['customer', query.customerId],
    ['employee', query.employeeId],
    ['status', query.status],
    ['paymentStatus', query.paymentStatus],
  ] as const) {
    if (value) {
      filter[key] = value;
    }
  }

  if (query.from || query.to) {
    filter.soldAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    SaleModel.find(filter)
      .sort({ soldAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<SaleDocument[]>()
      .exec(),
    SaleModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

/**
 * Cancels a completed sale and undoes everything it caused: the goods go back
 * into stock as `return` movements, its payments are voided and any debt it
 * created is cleared. The receipt itself is kept, marked cancelled.
 */
export const cancelSale = async (
  actor: AuthenticatedUser,
  id: string,
  reason: string,
): Promise<SaleDocument> => {
  assertRole(actor, CANCEL_ROLE);

  const sale = await getSale(actor, id);

  if (sale.status === 'cancelled') {
    throw ApiError.conflict('This sale has already been cancelled');
  }

  const branchId = String(sale.branch);
  const cancelledAt = new Date();
  const products = await productRepository.findManyByIds(
    sale.items.map((item) => String(item.product)),
  );
  const trackedProductIds = new Set(
    products.filter((product) => product.trackInventory).map((product) => String(product._id)),
  );

  return runInTransaction(async (session) => {
    await SaleModel.updateOne(
      { _id: sale._id, status: 'completed' },
      {
        $set: {
          status: 'cancelled',
          cancelledAt,
          note: sale.note ? `${sale.note}\nCancelled: ${reason}` : `Cancelled: ${reason}`,
        },
      },
      { session },
    ).exec();

    for (const item of sale.items) {
      if (!trackedProductIds.has(String(item.product))) {
        continue;
      }

      await recordMovement({
        actorId: actor.id,
        productId: String(item.product),
        branchId,
        type: 'return',
        quantity: item.quantity,
        reference: { kind: 'sale', id: String(sale._id) },
        note: `Sale ${sale.number} cancelled`,
        occurredAt: cancelledAt,
        session,
      });
    }

    await PaymentModel.updateMany(
      { sale: sale._id, status: 'completed' },
      { $set: { status: 'voided' } },
      { session },
    ).exec();

    // `dueAmount` is what this receipt still adds to the customer's balance:
    // the total less every payment already recorded against it. Removing it
    // returns the balance to where it stood before the sale. Money already
    // taken is refunded at the till, which is a cash movement, not a debt one.
    if (sale.customer && sale.totals.dueAmount > 0) {
      await customerRepository.adjustDebt(String(sale.customer), -sale.totals.dueAmount, session);
    }

    return { ...sale, status: 'cancelled' as const, cancelledAt };
  });
};
