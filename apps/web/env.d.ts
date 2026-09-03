/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_NAME?: string;
  /** Absolute API origin. Empty in development so the Vite proxy is used. */
  readonly VITE_API_BASE_URL?: string;
  /** Turns the router auth guard on; enabled once the auth module ships. */
  readonly VITE_AUTH_ENFORCED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
