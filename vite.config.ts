import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Pin PostCSS to an empty inline config: the design system uses plain CSS, and this
  // prevents Vite from walking up the directory tree and picking up unrelated
  // postcss.config files from parent folders (breaks vitest/build in monorepo-like setups).
  css: { postcss: {} },
  server: {
    port: 3000,
    host: true,
    strictPort: false,
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          react: ['react', 'react-dom'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
