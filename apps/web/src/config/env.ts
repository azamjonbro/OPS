const readBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  return value === 'true' || value === '1';
};

/**
 * Every `import.meta.env` read happens here, so a missing variable surfaces in
 * one place instead of failing deep inside a component.
 */
export const appConfig = {
  appName: import.meta.env.VITE_APP_NAME?.trim() || 'Hadiya',
  /** Empty in development: requests go to `/api` and the Vite proxy forwards them. */
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL?.trim() || '/api',
  features: {
    /**
     * The router auth guard. On by default now that authentication ships: an
     * unauthenticated visitor is sent to the login screen rather than to a
     * shell whose every request would fail with a 401.
     */
    authEnforced: readBoolean(import.meta.env.VITE_AUTH_ENFORCED, true),
  },
} as const;

export type AppConfig = typeof appConfig;
