/**
 * Creates the indexes every model declares, deliberately and on request.
 *
 * `connectDatabase` sets `autoIndex` to false in production, which is the right
 * default — Mongoose would otherwise issue index builds on every boot, and on a
 * collection of any size that is a foreground operation competing with live
 * traffic at exactly the moment a deployment is most fragile. The consequence
 * is that production has no other way to get its indexes, so this is it:
 *
 *   npm run db:indexes -w @hadiya/api
 *
 * Run it once after a deploy that adds or changes an index. It is safe to run
 * when nothing has changed — an index that already exists is left alone.
 *
 * What it will not do is drop anything. `syncIndexes()` removes indexes that
 * are no longer declared, which is the correct end state and the wrong thing to
 * do unattended: an index dropped by surprise turns a fast page into a
 * collection scan, and rebuilding it takes as long as it took the first time.
 * So this creates and reports, and anything left over is listed for a person to
 * decide about.
 */
import mongoose from 'mongoose';

import { config } from '../config/index.js';
import { connectDatabase, disconnectDatabase } from '../core/db/connection.js';
import { logger } from '../core/logger/logger.js';

// Importing the module registry is what registers every schema: the routers
// pull in controllers, which pull in services, which pull in models. Without it
// `mongoose.models` is empty and this script would cheerfully do nothing.
import '../modules/index.js';
import '../core/scheduler/scheduled-job.model.js';

const DROP_FLAG = '--drop-extra';

interface ModelReport {
  model: string;
  created: string[];
  extra: string[];
}

const indexNamesOf = async (model: mongoose.Model<unknown>): Promise<Set<string>> => {
  try {
    const existing = (await model.collection.indexes()) as Array<{ name?: string }>;

    return new Set(existing.map((index) => index.name ?? '').filter(Boolean));
  } catch {
    // A collection that does not exist yet has no indexes, which is not an
    // error — it is the ordinary state of a fresh deployment.
    return new Set();
  }
};

const run = async (): Promise<void> => {
  const dropExtra = process.argv.includes(DROP_FLAG);

  await connectDatabase();

  logger.info(
    { database: mongoose.connection.name, models: Object.keys(mongoose.models).length, dropExtra },
    'creating declared indexes',
  );

  const reports: ModelReport[] = [];

  for (const model of Object.values(mongoose.models)) {
    const before = await indexNamesOf(model as mongoose.Model<unknown>);

    // Creates what is missing and leaves what is already there. Unlike
    // `syncIndexes`, it never drops.
    await model.createIndexes();

    const after = await indexNamesOf(model as mongoose.Model<unknown>);
    const declared = new Set(
      model.schema.indexes().map(([fields, options]) => {
        const named = (options as { name?: string } | undefined)?.name;

        return (
          named ??
          Object.entries(fields)
            .map(([key, order]) => `${key}_${String(order)}`)
            .join('_')
        );
      }),
    );

    reports.push({
      model: model.modelName,
      created: [...after].filter((name) => !before.has(name)),
      // `_id_` is Mongo's own and is never declared by a schema.
      extra: [...after].filter((name) => name !== '_id_' && !declared.has(name)),
    });
  }

  for (const report of reports) {
    if (report.created.length > 0) {
      logger.info({ model: report.model, indexes: report.created }, 'indexes created');
    }

    if (report.extra.length > 0) {
      logger.warn(
        { model: report.model, indexes: report.extra },
        dropExtra
          ? 'dropping indexes no longer declared by the schema'
          : 'indexes exist that no schema declares; re-run with --drop-extra to remove them',
      );

      if (dropExtra) {
        for (const name of report.extra) {
          await (mongoose.models[report.model] as mongoose.Model<unknown>).collection.dropIndex(
            name,
          );
        }
      }
    }
  }

  const created = reports.reduce((total, report) => total + report.created.length, 0);
  const extra = reports.reduce((total, report) => total + report.extra.length, 0);

  logger.info(
    { models: reports.length, created, extra, environment: config.app.env },
    'index sync complete',
  );

  await disconnectDatabase();
};

run().catch((error: unknown) => {
  logger.fatal({ err: error }, 'index sync failed');
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 100).unref();
});
