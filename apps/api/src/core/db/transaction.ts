import mongoose, { type ClientSession } from 'mongoose';

import { createLogger } from '../logger/logger.js';

const log = createLogger('transaction');

/**
 * Multi-document transactions need a replica set or a sharded cluster; a
 * standalone `mongod` (common on a developer machine) rejects them.
 *
 * Support is probed once after connecting. Where it is missing the same
 * callback runs without a session: the writes are still ordered and still
 * validated, they simply are not atomic — acceptable for local work and not for
 * production, so the fallback says so loudly.
 */
let transactionsSupported: boolean | null = null;

/** Collection touched only by the probe; the read never creates it. */
const PROBE_COLLECTION = 'transaction_support_probe';
const ILLEGAL_OPERATION_CODE = 20;

const isUnsupportedTransactionError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as { code?: unknown }).code;

  return (
    code === ILLEGAL_OPERATION_CODE ||
    /transaction numbers are only allowed|transactions are not supported/i.test(error.message)
  );
};

/**
 * Starting a transaction is a client-side act: a standalone server only
 * complains when the first command carrying the transaction is sent. The probe
 * therefore performs a read inside the transaction rather than trusting
 * `startTransaction()` to throw.
 */
export const probeTransactionSupport = async (): Promise<boolean> => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    await mongoose.connection.db?.collection(PROBE_COLLECTION).findOne({}, { session });
    await session.abortTransaction();
    transactionsSupported = true;
  } catch (error) {
    if (!isUnsupportedTransactionError(error)) {
      throw error;
    }

    transactionsSupported = false;
    log.warn(
      'this MongoDB deployment does not support transactions, so multi-document writes (a sale and the stock it consumes) will not be atomic. Use a replica set in production.',
    );
  } finally {
    await session.endSession();
  }

  return transactionsSupported;
};

export const supportsTransactions = (): boolean => transactionsSupported === true;

/**
 * Runs `work` inside a transaction when the deployment supports one.
 *
 * The callback receives the session (or `undefined`) and must pass it to every
 * query it makes — a query without the session is not part of the transaction.
 */
export const runInTransaction = async <TResult>(
  work: (session: ClientSession | undefined) => Promise<TResult>,
): Promise<TResult> => {
  if (transactionsSupported === null) {
    await probeTransactionSupport();
  }

  if (!transactionsSupported) {
    return work(undefined);
  }

  const session = await mongoose.startSession();

  try {
    // `withTransaction` retries on transient errors, per the driver's contract.
    return await session.withTransaction(async () => work(session));
  } catch (error) {
    if (!isUnsupportedTransactionError(error)) {
      throw error;
    }

    // The deployment changed under us (a failover to a standalone, or a probe
    // that ran against a different node). The transaction was rejected before
    // anything was written, so re-running without a session is safe.
    transactionsSupported = false;
    log.warn('transactions became unavailable; retrying this write without one');

    return work(undefined);
  } finally {
    await session.endSession();
  }
};
