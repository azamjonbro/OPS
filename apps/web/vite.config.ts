import { fileURLToPath, URL } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig(({ mode }) => {
  // Env lives at the repo root so one file configures the whole monorepo.
  const env = loadEnv(mode, repoRoot, '');
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:4000';

  return {
    envDir: repoRoot,
    plugins: [vue(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      // Same-origin `/api` in development: no CORS, no absolute URLs in code.
      proxy: {
        '/api': { target: devApiTarget, changeOrigin: true },
      },
    },
    preview: { port: 4173 },
    build: {
      outDir: 'dist',
      sourcemap: mode !== 'production',
    },
  };
});
