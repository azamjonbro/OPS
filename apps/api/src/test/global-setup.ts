import mongoose from 'mongoose';

/**
 * Housekeeping for the database this run gets to itself.
 *
 * `vitest.config.ts` gives every run its own database so two runs cannot empty
 * each other's collections mid-test. The cost of that isolation is a new
 * database per run, and this is what stops them piling up.
 *
 * Two halves, because there are two ways a run ends. `teardown` drops the
 * database when the run finishes — passing or failing. `setup` sweeps up after
 * runs that never got to finish: a Ctrl-C, a killed worker, a CI job cancelled
 * mid-suite. Without the sweep, the isolation would trade a flaky suite for a
 * Mongo that grows a database every time somebody interrupts one.
 */

/** `hadiya-test-48213-9f2c1a` — the shape `withRunSuffix` produces. */
const RUN_DATABASE = /^(.+)-(\d+)-[0-9a-f]{6}$/;

/** Whether a process id is still running on this machine. */
const isAlive = (pid: number): boolean => {
  try {
    // Signal 0 asks whether the process exists without delivering anything.
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // `EPERM` means it exists and belongs to somebody else, which still counts.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/**
 * Whether this Mongo is one only this machine talks to.
 *
 * The sweep reads process ids out of database names, and a process id means
 * something only on the machine that issued it. On a shared server — a CI
 * Mongo, a team database — another runner's live pid could match a dead one
 * here and the sweep would drop a database somebody is using. So it runs only
 * against loopback, where every pid in a name is one of ours.
 */
const isLocal = (uri: string): boolean => {
  const { hostname } = new URL(uri);

  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
};

/**
 * This run's database, if it is one a run created.
 *
 * The suffix is the proof of that, and checking for it means a misconfigured
 * URI cannot make either half of this drop something somebody cares about.
 */
const runUri = (): string | undefined => {
  const uri = process.env.HADIYA_TEST_DATABASE_URI;

  if (!uri) {
    return undefined;
  }

  return RUN_DATABASE.test(new URL(uri).pathname.replace(/^\//, '')) ? uri : undefined;
};

export const setup = async (): Promise<void> => {
  const uri = runUri();

  if (!uri || !isLocal(uri)) {
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });

    const client = mongoose.connection.getClient();
    const { databases } = await client.db('admin').admin().listDatabases();
    const mine = new URL(uri).pathname.replace(/^\//, '');

    for (const { name } of databases) {
      const match = RUN_DATABASE.exec(name);

      if (!match || name === mine || isAlive(Number(match[2]))) {
        continue;
      }

      await client.db(name).dropDatabase();
      console.warn(`Removed ${name}, left behind by a run that did not finish.`);
    }
  } catch (error) {
    // Sweeping is a courtesy. Failing it would stop a suite that is otherwise
    // perfectly able to run.
    console.warn(
      `Could not sweep old test databases: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};

export const teardown = async (): Promise<void> => {
  const uri = runUri();

  if (!uri) {
    return;
  }

  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5_000 });
    await mongoose.connection.dropDatabase();
  } catch (error) {
    // A leftover database is untidy; failing the teardown would turn a green
    // suite red over housekeeping. The sweep above catches whatever is missed.
    console.warn(
      `Could not drop the test database: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await mongoose.disconnect().catch(() => undefined);
  }
};
