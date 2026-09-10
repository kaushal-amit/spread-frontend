import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

/**
 * D2 · FAIL THE BUILD when a production bundle has no backend base.
 *
 * client.ts already surfaces a runtime banner (configError), but a bundle that
 * has already shipped calling its own origin — the wss://kse-spread socket bug,
 * the whole-board 404s — is a bundle that should never have been produced. A
 * runtime warning is read after the deploy; a build that refuses to complete is
 * read before it. This is a plugin check, not a warning: `npm run build`
 * (production) with VITE_API_BASE empty aborts, naming the variable. Dev
 * (`vite`, command 'serve') is untouched — it proxies through the dev server —
 * and a deliberate non-production build (`--mode development`) is exempt.
 */
function requireApiBase(env: Record<string, string | undefined>, command: string, mode: string) {
  return {
    name: 'spread:require-api-base',
    buildStart() {
      if (command === 'build' && mode === 'production' && !env.VITE_API_BASE) {
        throw new Error(
          '[SPREAD build] VITE_API_BASE is not set. A production build with no backend URL ' +
          'calls its own origin — the bug that shipped the wss://kse-spread socket and the ' +
          'whole-board 404s. Set VITE_API_BASE (and VITE_INGEST_BASE) to the backend/scraper ' +
          'origin before building, or build with --mode development for a local bundle.');
      }
    },
  };
}

export default defineConfig(({ mode, command }) => {
  /*
   * F-10 · Vite does NOT put .env values on process.env. `process.env.BACKEND_URL`
   * was always undefined, so the documented setup (copy .env.example) did
   * nothing and the proxy silently used the defaults. loadEnv reads the .env
   * files for this mode; the third argument '' admits keys without a VITE_
   * prefix, which these two deliberately lack — they are the dev server's,
   * not the browser's.
   */
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    plugins: [react(), tailwindcss(), requireApiBase(env, command, mode)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: env.DISABLE_HMR === 'true' ? null : {},

      /**
       * TWO SERVICES, ONE ORIGIN.
       *
       * The SCRAPER owns capture and the depth slots (/ingest); the BACKEND
       * owns everything computed (/api) and the socket. Proxying both means no
       * CORS on either — and when this sits behind a reverse proxy in
       * production it is already a single origin, which is one less thing to
       * unpick.
       *
       * Ports come from the environment so a developer running the backend
       * elsewhere does not have to edit this file.
       */
      proxy: {
        '/api': {
          target: env.BACKEND_URL || 'http://localhost:4000',
          changeOrigin: true,
        },
        '/ingest': {
          target: env.SCRAPER_URL || 'http://localhost:8787',
          changeOrigin: true,
        },
        '/socket.io': {
          target: env.BACKEND_URL || 'http://localhost:4000',
          ws: true,
        },
      },
    },
  };
});
