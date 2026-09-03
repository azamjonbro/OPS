import { existsSync } from 'node:fs';
import path from 'node:path';

import dotenv from 'dotenv';

import { API_ROOT, REPO_ROOT } from './paths.js';

/**
 * Loads env files from most to least specific. Nothing overrides a variable
 * that is already set, so the process environment (containers, CI, systemd)
 * always wins over a file on disk.
 */
export const loadEnvFiles = (nodeEnv = process.env.NODE_ENV ?? 'development'): string[] => {
  const candidates = [
    path.join(API_ROOT, `.env.${nodeEnv}.local`),
    path.join(API_ROOT, '.env.local'),
    path.join(API_ROOT, `.env.${nodeEnv}`),
    path.join(API_ROOT, '.env'),
    path.join(REPO_ROOT, '.env'),
  ];

  const loaded: string[] = [];

  for (const file of candidates) {
    if (!existsSync(file)) {
      continue;
    }

    dotenv.config({ path: file, override: false, quiet: true });
    loaded.push(file);
  }

  return loaded;
};
