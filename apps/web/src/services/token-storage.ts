import type { AuthTokens } from '@hadiya/shared';

const STORAGE_KEY = 'hadiya.auth.tokens';

/**
 * Kept separate from the auth store so the HTTP layer can read the access
 * token without importing a Pinia store (which would create a cycle).
 */
export const tokenStorage = {
  read(): AuthTokens | null {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'accessToken' in parsed &&
        typeof (parsed as { accessToken: unknown }).accessToken === 'string'
      ) {
        return parsed as AuthTokens;
      }
    } catch {
      // Corrupted storage is treated as "signed out".
    }

    window.localStorage.removeItem(STORAGE_KEY);

    return null;
  },

  write(tokens: AuthTokens): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  },

  clear(): void {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};
