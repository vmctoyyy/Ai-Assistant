import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      // The artifact is published as a single self-contained file, so it
      // cannot fetch a lazy chunk. Everywhere else the Firebase SDK stays
      // split out, and an app with no database configured never loads it.
      output: { inlineDynamicImports: mode === 'artifact' },
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
}));
