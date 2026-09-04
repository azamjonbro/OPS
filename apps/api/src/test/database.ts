import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../core/db/connection.js';
import { probeTransactionSupport } from '../core/db/transaction.js';

/**
 * Opens the test database and makes sure every declared index exists — the
 * uniqueness rules under test are enforced by the indexes, not by application
 * code, so a test run without them would pass while production failed.
 */
export const startTestDatabase = async (): Promise<void> => {
  await connectDatabase();
  await probeTransactionSupport();

  await Promise.all(Object.values(mongoose.models).map((model) => model.syncIndexes()));
};

export const stopTestDatabase = async (): Promise<void> => {
  await disconnectDatabase();
};

/** Empties every collection between tests without dropping the indexes. */
export const clearTestDatabase = async (): Promise<void> => {
  await Promise.all(
    Object.values(mongoose.connection.collections).map((collection) => collection.deleteMany({})),
  );
};
