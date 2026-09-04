/**
 * Creates the first owner account so the system can be signed into at all.
 *
 * Run once per deployment:
 *   npm run create-owner -w @hadiya/api -- --username owner --password '<secret>' --name 'Full Name'
 *
 * It refuses to run when any account already exists, so it cannot be used to
 * quietly add a privileged user to a live system.
 */
import { DEFAULT_TIMEZONE, isValidTimeZone } from '@hadiya/shared';

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
  const password = readFlag('password');
  const fullName = readFlag('name')?.trim();
  // Reminders are set and shown in it, so it is worth getting right at the
  // start; the account default covers a deployment that leaves it out.
  const timezone = readFlag('timezone')?.trim() || DEFAULT_TIMEZONE;

  if (!username || !password || !fullName) {
    throw new Error(
      'Usage: create-owner --username <username> --password <password> --name <full name> [--timezone <IANA zone>]',
    );
  }

  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`The password must be at least ${MINIMUM_PASSWORD_LENGTH} characters`);
  }

  if (!isValidTimeZone(timezone)) {
    throw new Error(`"${timezone}" is not an IANA time zone name`);
  }

  await connectDatabase();

  try {
    const existing = await UserModel.countDocuments().exec();

    if (existing > 0) {
      throw new Error(
        'This system already has accounts; create further users through the API instead',
      );
    }

    const owner = await UserModel.create({
      username,
      passwordHash: await hashPassword(password),
      fullName,
      role: 'owner',
      status: 'active',
      phone: null,
      branch: null,
      timezone,
      lastLoginAt: null,
    });

    logger.info(
      { username: owner.username, id: String(owner._id), timezone: owner.timezone },
      'owner account created',
    );
  } finally {
    await disconnectDatabase();
  }
};

run()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    logger.fatal({ err: error }, 'could not create the owner account');
    // The logger transport runs on its own thread; give it a tick to flush,
    // then exit rather than leaving the script hanging on an open worker.
    setTimeout(() => process.exit(1), 100);
  });
