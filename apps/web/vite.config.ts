import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  resolve: {
    /**
     * Force ONE React for the whole dependency graph.
     *
     * In a workspace, `react-router-dom` hoists to the repo root while this app
     * can keep its own nested copy. Two Reacts means two hook dispatchers, and
     * the second one is null — which surfaces as "Invalid hook call" and
     * "Cannot read properties of null (reading 'useRef')" from inside
     * BrowserRouter, nowhere near the actual cause. The page renders nothing.
     *
     * The root package.json `overrides` pin the version; this makes sure every
     * importer resolves to the SAME copy regardless of where npm puts it.
     */
    dedupe: ['react', 'react-dom'],
  },
});
