import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({ mode }) => {
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
    plugins: [react(), tailwindcss()],
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
