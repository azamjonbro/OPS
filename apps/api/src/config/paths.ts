import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Resolved from this module's own location, so the paths are identical whether
 * the API runs from `src` (tsx) or from `dist` (compiled) — both live one level
 * below the package root.
 */
const currentDir = path.dirname(fileURLToPath(import.meta.url));

export const API_ROOT = path.resolve(currentDir, '../..');
export const REPO_ROOT = path.resolve(API_ROOT, '../..');
