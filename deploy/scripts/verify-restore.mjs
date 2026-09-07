/**
 * Looks at a restored database and says whether it is one Hadiya can run on.
 *
 *   node deploy/scripts/verify-restore.mjs mongodb://127.0.0.1:27017/hadiya-restore-test
 *
 * Called by `restore.sh`, and worth running on its own after any recovery. It
 * exists because `mongorestore` exiting zero says only that the archive was
 * read, not that anything useful landed: a wrong namespace, an archive from a
 * different deployment or a half-written dump all restore "successfully" into
 * an empty database.
 *
 * So this checks the three things that would actually matter the morning after
 * a recovery: that the collections a running system needs are present, that the
 * one collection nothing works without has rows in it, and that the indexes are
 * there — a restore that dropped them leaves a system that runs and gets slower
 * every week.
 *
 * It only ever reads.
 */
import mongoose from 'mongoose';

/** Without a user nobody can sign in, so an empty one means a failed restore. */
const MUST_HAVE_ROWS = ['users'];

/**
 * Collections a working deployment has. A fresh shop legitimately has none of
 * its own content yet, so an empty one is reported and not treated as failure.
 */
const EXPECTED = [
  'users',
  'conversations',
  'messages',
  'memories',
  'reminders',
  'notifications',
  'files',
  'contentplans',
  'contentitems',
  'imageassets',
  'integrations',
  'pendingactions',
  'alerts',
  'scheduledjobs',
];

const uri = process.argv[2];

if (!uri) {
  console.error('Usage: verify-restore.mjs <mongo-uri>');
  process.exit(1);
}

const problems = [];
const notes = [];

await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });

const database = mongoose.connection.db;
const present = new Set((await database.listCollections().toArray()).map((c) => c.name));

console.log(`\nDatabase "${database.databaseName}" — ${present.size} collection(s).\n`);

let totalDocuments = 0;
let totalIndexes = 0;

for (const name of EXPECTED) {
  if (!present.has(name)) {
    notes.push(`${name}: absent (a deployment that never used this feature would look like this)`);
    continue;
  }

  const collection = database.collection(name);
  const count = await collection.countDocuments();
  const indexes = await collection.indexes();

  totalDocuments += count;
  totalIndexes += indexes.length;

  console.log(
    `  ${name.padEnd(16)} ${String(count).padStart(7)} document(s)  ${indexes.length} index(es)`,
  );

  if (MUST_HAVE_ROWS.includes(name) && count === 0) {
    problems.push(`${name} is empty: nobody could sign in to this restore`);
  }

  // `_id_` is always there; anything beyond it is a declared index.
  if (count > 0 && indexes.length <= 1) {
    problems.push(
      `${name} has documents but no declared indexes — run "npm run db:indexes -w @hadiya/api"`,
    );
  }
}

// Read one document end to end, to prove the data is not merely counted but
// actually readable — a truncated restore can leave documents that fail to
// deserialise.
if (present.has('users')) {
  const sample = await database
    .collection('users')
    .findOne({}, { projection: { username: 1, role: 1, status: 1 } });

  if (!sample) {
    problems.push('users has rows by count but none could be read');
  } else {
    console.log(`\n  Read a user back: role "${sample.role}", status "${sample.status}".`);
  }
}

/**
 * The check that matters most, and the one this file originally missed.
 *
 * Every collection being *absent* was reported as fourteen mild notes and a
 * cheerful "restore verified" — which is precisely the false confidence this
 * script exists to prevent. A restore that produced nothing at all is the most
 * likely way for one to fail (a wrong namespace, an archive from elsewhere)
 * and it must be the loudest thing here, not the quietest.
 */
if (totalDocuments === 0) {
  problems.push('the restore produced no documents at all: nothing was written to this database');
}

if (!present.has('users')) {
  problems.push('there is no users collection, so this is not a Hadiya database');
}

console.log(
  `\n  ${totalDocuments} document(s) and ${totalIndexes} index(es) across the collections present.`,
);

for (const note of notes) {
  console.log(`  note: ${note}`);
}

await mongoose.disconnect();

if (problems.length > 0) {
  console.error('\nThis restore is NOT usable:');

  for (const problem of problems) {
    console.error(`  - ${problem}`);
  }

  process.exit(1);
}

console.log(
  '\nRestore verified: the collections a running system needs are present and readable.\n',
);
