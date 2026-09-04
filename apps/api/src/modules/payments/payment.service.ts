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
import { customerRepository } from '../customers/customer.repository.js';
import { SaleModel, type SaleDocument } from '../sales/sale.model.js';
import { PaymentModel, type PaymentDocument } from './payment.model.js';
import type { ListPaymentsQuery, RecordPaymentInput } from './payment.validators.js';

/** Voiding a payment rewrites the books, so it is a supervisor action. */
const VOID_ROLE = 'manager' as const;

export interface CreatePaymentRecord {
  branchId: string;
  saleId: string | null;
  customerId: string | null;
  amount: number;
  method: PaymentDocument['method'];
  reference?: string | null;
  receivedById: string;
  paidAt: Date;
  session?: ClientSession | undefined;
}

/**
 * Writes one payment document. Used both by the payments endpoint and by the
 * sale service when a sale is paid at the till, so the two paths cannot drift.
 */
export const createPaymentRecord = async (input: CreatePaymentRecord): Promise<PaymentDocument> => {
  const [payment] = await PaymentModel.create(
    [
      {
        branch: toObjectId(input.branchId),
        sale: toObjectIdOrNull(input.saleId),
        customer: toObjectIdOrNull(input.customerId),
        amount: input.amount,
        method: input.method,
        direction: 'in',
        status: 'completed',
        reference: input.reference ?? null,
        receivedBy: toObjectId(input.receivedById),
        paidAt: input.paidAt,
      },
    ],
    { session: input.session },
  );

  if (!payment) {
    throw ApiError.internal('The payment could not be recorded');
  }

  return payment.toObject<PaymentDocument>();
};

/** Recomputes a sale's paid and due amounts after a payment changed. */
const applyPaymentToSale = async (
  sale: SaleDocument,
  delta: number,
  session: ClientSession | undefined,
): Promise<void> => {
  const paidAmount = sale.totals.paidAmount + delta;
  const dueAmount = Math.max(sale.totals.grandTotal - paidAmount, 0);

  await SaleModel.updateOne(
    { _id: sale._id },
    {
      $set: {
        'totals.paidAmount': paidAmount,
        'totals.dueAmount': dueAmount,
        paymentStatus: resolveSalePaymentStatus(sale.totals.grandTotal, paidAmount),
      },
    },
    { session },
  ).exec();
};

/**
 * Records money received after the sale itself — settling a receipt that was
 * left partly unpaid, or paying down a customer's balance.
 *
 * The payment, the receipt's paid amount and the customer's debt all move
 * together, so the three can never disagree.
 */
export const recordPayment = async (
  actor: AuthenticatedUser,
  input: RecordPaymentInput,
): Promise<PaymentDocument> => {
  const sale = input.saleId
    ? await SaleModel.findById(input.saleId).lean<SaleDocument | null>().exec()
    : null;

  if (input.saleId && !sale) {
    throw ApiError.notFound('Sale not found');
  }

  if (sale && sale.status === 'cancelled') {
    throw ApiError.conflict('A cancelled sale cannot take a payment');
  }

  const branchId = resolveBranchForWrite(
    actor,
    sale ? String(sale.branch) : (input.branchId ?? null),
  );

  const customerId = input.customerId ?? (sale?.customer ? String(sale.customer) : null);

  if (customerId) {
    const customer = await customerRepository.findById(customerId);

    if (!customer) {
      throw ApiError.notFound('Customer not found');
    }
  }

  if (sale && input.amount > sale.totals.dueAmount) {
    throw ApiError.badRequest('The payment is larger than the amount still due on this sale');
  }

  return runInTransaction(async (session) => {
    const payment = await createPaymentRecord({
      branchId,
      saleId: input.saleId ?? null,
      customerId,
      amount: input.amount,
      method: input.method,
      reference: input.reference ?? null,
      receivedById: actor.id,
      paidAt: input.paidAt ?? new Date(),
      session,
    });

    if (sale) {
      await applyPaymentToSale(sale, input.amount, session);
    }

    if (customerId) {
      // Paying reduces what the customer owes.
      await customerRepository.adjustDebt(customerId, -input.amount, session);
    }

    return payment;
  });
};

/**
 * Reverses a payment that should not have been taken. The document is kept and
 * marked `voided` rather than deleted: the cash drawer history has to show that
 * it happened and that it was undone.
 */
export const voidPayment = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<PaymentDocument> => {
  assertRole(actor, VOID_ROLE);

  const payment = await PaymentModel.findById(id).lean<PaymentDocument | null>().exec();

  if (!payment) {
    throw ApiError.notFound('Payment not found');
  }

  assertBranchAccess(actor, String(payment.branch));

  if (payment.status === 'voided') {
    throw ApiError.conflict('This payment has already been voided');
  }

  return runInTransaction(async (session) => {
    await PaymentModel.updateOne(
      { _id: payment._id },
      { $set: { status: 'voided' } },
      { session },
    ).exec();

    if (payment.sale) {
      const sale = await SaleModel.findById(payment.sale)
        .session(session ?? null)
        .lean<SaleDocument | null>()
        .exec();

      if (sale) {
        await applyPaymentToSale(sale, -payment.amount, session);
      }
    }

    if (payment.customer) {
      // Undoing a payment puts the debt back.
      await customerRepository.adjustDebt(String(payment.customer), payment.amount, session);
    }

    return { ...payment, status: 'voided' as const };
  });
};

export const getPayment = async (
  actor: AuthenticatedUser,
  id: string,
): Promise<PaymentDocument> => {
  const payment = await PaymentModel.findById(id).lean<PaymentDocument | null>().exec();

  if (!payment) {
    throw ApiError.notFound('Payment not found');
  }

  assertBranchAccess(actor, String(payment.branch));

  return payment;
};

export const listPayments = async (
  actor: AuthenticatedUser,
  query: ListPaymentsQuery,
): Promise<PaginatedResult<PaymentDocument>> => {
  const filter: Record<string, unknown> = {};

  if (canAccessAllBranches(actor)) {
    if (query.branchId) {
      filter.branch = query.branchId;
    }
  } else {
    filter.branch = requireActorBranch(actor);
  }

  for (const [key, value] of [
    ['sale', query.saleId],
    ['customer', query.customerId],
    ['method', query.method],
    ['status', query.status],
  ] as const) {
    if (value) {
      filter[key] = value;
    }
  }

  if (query.from || query.to) {
    filter.paidAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    PaymentModel.find(filter)
      .sort({ paidAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<PaymentDocument[]>()
      .exec(),
    PaymentModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};
