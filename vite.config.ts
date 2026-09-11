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
      const blank = (v: string | undefined) => !v || !v.trim();
      if (command === 'build' && mode === 'production' && blank(env.VITE_API_BASE)) {
        throw new Error(
          '[SPREAD build] VITE_API_BASE is not set. A production build with no backend URL ' +
          'calls its own origin — the bug that shipped the wss://kse-spread socket and the ' +
          'whole-board 404s. Set VITE_API_BASE to the backend origin before building, or build ' +
          'with --mode development for a local bundle.');
      }
      /*
       * D3 · NO SECRET IN THE BUNDLE. The two tokens that used to be compiled
       * in are refused outright, in every mode: a build that has them set is a
       * build that would ship them. Production also needs the Firebase web
       * config (public by design) or the terminal can never sign in.
       */
      if (command === 'build') {
        for (const k of ['VITE_SPREAD_API_TOKEN', 'VITE_INGEST_TOKEN']) {
          if (!blank(env[k])) {
            throw new Error(
              `[SPREAD build] ${k} is set. Since D3 the terminal signs in with Firebase and sends ` +
              'the user\'s ID token; no static token may be compiled into the public bundle. ' +
              'Remove the variable (and rotate the token — every bundle that carried it is public).');
          }
        }
      }
      if (command === 'build' && mode === 'production') {
        const missing = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID'].filter((k) => blank(env[k]));
        if (missing.length) {
          throw new Error(
            `[SPREAD build] ${missing.join(', ')} not set. A production bundle signs in with Firebase ` +
            '(D3) and cannot without its web config — Firebase console › Project settings › Your apps.');
        }
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
