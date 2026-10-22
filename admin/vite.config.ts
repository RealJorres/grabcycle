/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Hosting serves admin/dist (see firebase.json). No source maps in production
    // bundles; they would expose internal structure to anyone with the URL.
    sourcemap: false,
    target: 'es2023',
    // The Firebase SDK is most of the bytes and changes rarely: give it its own
    // long-cached chunk so dashboard releases do not force a re-download.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'firebase', test: /node_modules[\\/](@firebase|firebase)[\\/]/, priority: 2 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 1 },
          ],
        },
      },
    },
    // Firestore alone exceeds Vite's generic 500 kB hint; it is cached separately (above).
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173, strictPort: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    restoreMocks: true,
  },
});
