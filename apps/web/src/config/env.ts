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
     * The router auth guard. Off until the auth module exists server-side;
     * the guard itself is fully implemented.
     */
    authEnforced: readBoolean(import.meta.env.VITE_AUTH_ENFORCED, false),
  },
} as const;

export type AppConfig = typeof appConfig;
