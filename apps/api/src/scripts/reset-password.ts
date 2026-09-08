/**
 * Replaces the password of an account that already exists, for when nobody can
 * sign in any more.
 *
 * Run on the machine that can reach the database:
 *   npm run reset-password -w @hadiya/api -- --username owner --password '<secret>'
 *
 * Passwords are stored as one-way scrypt hashes, so a forgotten one can never
 * be read back — only replaced. The account has to exist already: this is a
 * recovery tool, not a second way to create privileged users.
 *
 * A password given as a flag is visible in the shell history and in `ps`, so on
 * a shared machine pass it through the environment instead:
 *   NEW_PASSWORD='<secret>' npm run reset-password -w @hadiya/api -- --username owner
 */
import { connectDatabase, disconnectDatabase } from '../core/db/connection.js';
import { hashPassword } from '../core/security/password.js';
import { logger } from '../core/logger/logger.js';
import { UserModel } from '../modules/users/user.model.js';

const MINIMUM_PASSWORD_LENGTH = 8;

const readFlag = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
};

const run = async (): Promise<void> => {
  const username = readFlag('username')?.trim().toLowerCase();
  const password = readFlag('password') ?? process.env.NEW_PASSWORD;

  if (!username || !password) {
    throw new Error(
      'Usage: reset-password --username <username> [--password <password>] (or NEW_PASSWORD in the environment)',
    );
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`);
  }

  await connectDatabase();

  try {
    // `new: true` so the log below reports the account that was actually
    // touched rather than the arguments it was asked for.
    const user = await UserModel.findOneAndUpdate(
      { username },
      { passwordHash: await hashPassword(password) },
      { new: true },
    ).exec();

    if (!user) {
      throw new Error(`No account has the username "${username}"`);
    }

    logger.info(
      { username: user.username, id: String(user._id), role: user.role },
      'password reset',
    );

    // A new password does not lift a suspension, and the login would fail for
    // a reason that has nothing to do with the password. Say so here.
    if (user.status !== 'active') {
      logger.warn(
        { username: user.username, status: user.status },
        'the account is not active, so signing in will still be refused',
      );
    }

    // Refresh tokens are self-contained JWTs rather than database rows, so any
    // session issued before this reset stays valid until it expires.
    logger.info('sessions issued before this reset remain valid until they expire');
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'could not reset the password');
    // The logger transport runs on its own thread; give it a tick to flush,
    // then exit rather than leaving the script hanging on an open worker.
    setTimeout(() => process.exit(1), 100);
  });
