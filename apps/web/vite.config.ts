import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/** Baked into the bundle at build time, so a missing one cannot be fixed after deploy. */
const REQUIRED_ENV = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];

export default defineConfig(({ command, mode }) => {
  /*
   * Fail the BUILD, not the browser.
   *
   * src/lib/supabase.ts throws when these are missing, but that throw happens
   * in the user's browser — a deploy with unset environment variables builds
   * green and serves a white screen. On Vercel these come from the project's
   * Environment Variables, not from a .env file, so this is the only place
   * that can catch the mistake while it is still cheap.
   */
  if (command === 'build') {
    const env = loadEnv(mode, new URL('.', import.meta.url).pathname, 'VITE_');
    const missing = REQUIRED_ENV.filter((k) => !env[k]);
    if (missing.length) {
      throw new Error(
        `Cannot build: ${missing.join(', ')} not set.\n` +
          'Locally these live in apps/web/.env.local; on Vercel set them under ' +
          'Project Settings -> Environment Variables for every environment you deploy.',
      );
    }
  }

  return {
    plugins: [react()],
    resolve: {
      /**
       * Force ONE React for the whole dependency graph.
       *
       * In a workspace, `react-router-dom` hoists to the repo root while this app
       * can keep its own nested copy. Two Reacts means two hook dispatchers, and
       * the second one is null — which surfaces as 'Invalid hook call' and
       * 'Cannot read properties of null (reading 'useRef')' from inside
       * BrowserRouter, nowhere near the actual cause. The page renders nothing.
       *
       * The root package.json `overrides` pin the version; this makes sure every
       * importer resolves to the SAME copy regardless of where npm puts it.
       */
      dedupe: ['react', 'react-dom'],
    },
  };
});
