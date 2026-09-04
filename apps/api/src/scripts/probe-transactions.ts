/**
 * Reports whether the configured MongoDB deployment supports transactions.
 * Useful when preparing an environment: production must answer `true`.
 *
 *   npm run probe-transactions -w @hadiya/api
 */
import { connectDatabase, disconnectDatabase } from '../core/db/connection.js';
import { probeTransactionSupport } from '../core/db/transaction.js';
import { config } from '../config/index.js';
import { logger } from '../core/logger/logger.js';

const run = async (): Promise<void> => {
  await connectDatabase();

  try {
    const supported = await probeTransactionSupport();

    logger.info(
      { uri: config.database.uri.replace(/\/\/[^@]*@/, '//<credentials>@'), supported },
      supported ? 'transactions are available' : 'transactions are NOT available',
    );
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'could not probe transaction support');
    setTimeout(() => process.exit(1), 100);
  });
