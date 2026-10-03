import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Component tests for the dashboard, in jsdom.
 *
 * Separate from vite.config.ts on purpose: that file refuses to BUILD without
 * the Supabase env vars, and tests must not need real credentials -- they mock
 * the data layer at the module boundary instead.
 *
 * Vitest 5 (supports Vite 6-8), jsdom 30, Testing Library 16 -- checked
 * against npm and the projects' peer ranges, Oct 2026.
 */
export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
