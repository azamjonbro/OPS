import {
  allowsFractionalQuantity,
  buildPaginationMeta,
  resolvePagination,
  toSignedQuantity,
  type AuthenticatedUser,
  type InventoryMovementType,
  type MovementReferenceKind,
  type PaginatedResult,
} from '@hadiya/shared';
import type { ClientSession } from 'mongoose';

import { toObjectId } from '../../core/db/object-id.js';
import { runInTransaction } from '../../core/db/transaction.js';
import { ApiError } from '../../core/http/api-error.js';
import {
  assertRole,
  canAccessAllBranches,
  requireActorBranch,
  resolveBranchForRead,
  resolveBranchForWrite,
} from '../../core/security/actor.js';
import { branchRepository } from '../branches/branch.repository.js';
import { productRepository } from '../products/product.repository.js';
import { InventoryItemModel, type InventoryItemDocument } from './inventory-item.model.js';
import {
  InventoryMovementModel,
  type InventoryMovementDocument,
} from './inventory-movement.model.js';
import type { ListMovementsQuery, ListStockQuery } from './inventory.validators.js';

/** Receiving stock, correcting a count and transferring are supervisor actions. */
const MANAGE_ROLE = 'manager' as const;

export interface RecordMovementInput {
  actorId: string;
  productId: string;
  branchId: string;
  type: InventoryMovementType;
  /** Magnitude; the movement type decides the sign (adjustments keep theirs). */
  quantity: number;
  reference: { kind: MovementReferenceKind; id: string | null };
  note?: string | null;
  occurredAt?: Date;
  session?: ClientSession | undefined;
}

export interface MovementResult {
  movement: InventoryMovementDocument;
  balanceAfter: number;
}

const assertQuantityFitsUnit = (
  unit: Parameters<typeof allowsFractionalQuantity>[0],
  quantity: number,
): void => {
  if (!allowsFractionalQuantity(unit) && !Number.isInteger(quantity)) {
    throw ApiError.badRequest(`A product sold by ${unit} cannot move in fractional quantities`);
  }
};

/**
 * The single writer of stock levels.
 *
 * Every change goes through here so that the level and its audit record are
 * always written together: nothing anywhere else may touch `InventoryItem`.
 *
 * The level is changed with a conditional `$inc`, so two concurrent sales of
 * the last unit cannot both succeed — the second one finds no matching document
 * and is rejected — with or without a surrounding transaction.
 */
export const recordMovement = async (input: RecordMovementInput): Promise<MovementResult> => {
  const product = await productRepository.findById(input.productId);

  if (!product) {
    throw ApiError.badRequest('The product does not exist');
  }

  if (!product.trackInventory) {
    throw ApiError.badRequest(`Stock is not tracked for "${product.name}"`);
  }

  if (input.quantity === 0) {
    throw ApiError.badRequest('A movement quantity cannot be zero');
  }

  assertQuantityFitsUnit(product.unit, input.quantity);

  const delta = toSignedQuantity(input.type, input.quantity);
  const isDecrease = delta < 0;

  const filter: Record<string, unknown> = {
    product: toObjectId(input.productId),
    branch: toObjectId(input.branchId),
  };

  if (isDecrease) {
    // Only match when there is enough on hand; stock may never go negative.
    filter.quantity = { $gte: Math.abs(delta) };
  }

  const item = await InventoryItemModel.findOneAndUpdate(
    filter,
    { $inc: { quantity: delta } },
    {
      returnDocument: 'after',
      // A decrease can never create a stock row: there is nothing to take from.
      upsert: !isDecrease,
      session: input.session,
      setDefaultsOnInsert: true,
    },
  )
    .lean<InventoryItemDocument | null>()
    .exec();

  if (!item) {
    throw ApiError.conflict(`Not enough stock for "${product.name}" at this branch`);
  }

  const [movement] = await InventoryMovementModel.create(
    [
      {
        product: toObjectId(input.productId),
        branch: toObjectId(input.branchId),
        type: input.type,
        quantity: delta,
        balanceAfter: item.quantity,
        reference: {
          kind: input.reference.kind,
          id: input.reference.id ? toObjectId(input.reference.id) : null,
        },
        note: input.note ?? null,
        createdBy: toObjectId(input.actorId),
        occurredAt: input.occurredAt ?? new Date(),
      },
    ],
    { session: input.session },
  );

  if (!movement) {
    throw ApiError.internal('The stock movement could not be recorded');
  }

  return { movement: movement.toObject<InventoryMovementDocument>(), balanceAfter: item.quantity };
};

export const getStockLevel = async (
  productId: string,
  branchId: string,
  session?: ClientSession,
): Promise<number> => {
  const item = await InventoryItemModel.findOne({
    product: toObjectId(productId),
    branch: toObjectId(branchId),
  })
    .session(session ?? null)
    .lean<InventoryItemDocument | null>()
    .exec();

  return item?.quantity ?? 0;
};

export interface ManualMovementInput {
  productId: string;
  branchId?: string | null;
  type: InventoryMovementType;
  quantity: number;
  note?: string | null;
  occurredAt?: Date;
}

/**
 * Stock received, returned or corrected by hand. A `sale` movement is not
 * accepted here: sales are the only thing that may write one, so the stock card
 * cannot be made to disagree with the sales ledger.
 */
export const recordManualMovement = async (
  actor: AuthenticatedUser,
  input: ManualMovementInput,
): Promise<MovementResult> => {
  assertRole(actor, MANAGE_ROLE);

  const branchId = resolveBranchForWrite(actor, input.branchId ?? null);

  if (!(await branchRepository.isActive(branchId))) {
    throw ApiError.badRequest('The branch does not exist or is not active');
  }

  return recordMovement({
    actorId: actor.id,
    productId: input.productId,
    branchId,
    type: input.type,
    quantity: input.quantity,
    reference: { kind: 'manual', id: null },
    note: input.note ?? null,
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  });
};

export interface TransferInput {
  productId: string;
  fromBranchId: string;
  toBranchId: string;
  quantity: number;
  note?: string | null;
}

/**
 * Moves stock between branches as a pair of movements. Both legs are written in
 * one transaction: stock must never be missing from both branches at once, nor
 * present in both.
 */
export const transferStock = async (
  actor: AuthenticatedUser,
  input: TransferInput,
): Promise<{ from: MovementResult; to: MovementResult }> => {
  assertRole(actor, MANAGE_ROLE);

  if (input.fromBranchId === input.toBranchId) {
    throw ApiError.badRequest('The source and destination branches must differ');
  }

  // Branch-bound staff may only send stock away from their own branch.
  resolveBranchForWrite(actor, input.fromBranchId);

  for (const branchId of [input.fromBranchId, input.toBranchId]) {
    if (!(await branchRepository.isActive(branchId))) {
      throw ApiError.badRequest('The branch does not exist or is not active');
    }
  }

  return runInTransaction(async (session) => {
    const occurredAt = new Date();

    const from = await recordMovement({
      actorId: actor.id,
      productId: input.productId,
      branchId: input.fromBranchId,
      type: 'transfer_out',
      quantity: input.quantity,
      reference: { kind: 'transfer', id: null },
      note: input.note ?? null,
      occurredAt,
      session,
    });

    const to = await recordMovement({
      actorId: actor.id,
      productId: input.productId,
      branchId: input.toBranchId,
      type: 'transfer_in',
      quantity: input.quantity,
      reference: { kind: 'transfer', id: null },
      note: input.note ?? null,
      occurredAt,
      session,
    });

    return { from, to };
  });
};

export const listStock = async (
  actor: AuthenticatedUser,
  query: ListStockQuery,
): Promise<PaginatedResult<InventoryItemDocument>> => {
  const filter: Record<string, unknown> = {};
  const branchId = resolveBranchForRead(actor, query.branchId ?? null);

  if (branchId) {
    filter.branch = branchId;
  }

  if (query.productId) {
    filter.product = query.productId;
  }

  if (query.maxQuantity !== undefined) {
    filter.quantity = { $lte: query.maxQuantity };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    InventoryItemModel.find(filter)
      // Lowest stock first: the reason to open this list is to find what to reorder.
      .sort({ quantity: 1 })
      .skip(skip)
      .limit(limit)
      .lean<InventoryItemDocument[]>()
      .exec(),
    InventoryItemModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};

export const listMovements = async (
  actor: AuthenticatedUser,
  query: ListMovementsQuery,
): Promise<PaginatedResult<InventoryMovementDocument>> => {
  const filter: Record<string, unknown> = {};
  const branchId = canAccessAllBranches(actor)
    ? (query.branchId ?? null)
    : requireActorBranch(actor);

  if (branchId) {
    filter.branch = branchId;
  }

  if (query.productId) {
    filter.product = query.productId;
  }

  if (query.type) {
    filter.type = query.type;
  }

  if (query.from || query.to) {
    filter.occurredAt = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
  }

  const { page, pageSize, skip, limit } = resolvePagination(query);

  const [items, total] = await Promise.all([
    InventoryMovementModel.find(filter)
      .sort({ occurredAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean<InventoryMovementDocument[]>()
      .exec(),
    InventoryMovementModel.countDocuments(filter).exec(),
  ]);

  return { items, pagination: buildPaginationMeta({ page, pageSize }, total) };
};
