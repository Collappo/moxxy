import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * electron-vite manages three build targets (main / preload / renderer)
 * with one config. Each has its own output dir under `dist-electron/`,
 * and the renderer also writes to `dist/` so it can be served by Vite
 * during dev and packaged by electron-builder for production.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/main',
      rollupOptions: {
        input: { index: path.resolve('electron/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron/preload',
      rollupOptions: {
        input: { index: path.resolve('electron/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: '.',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@shared': path.resolve(__dirname, 'electron/shared'),
      },
      // Dedupe React + clerk-react so the wizard's ClerkProvider and
      // any hook that reads Clerk context share a single React tree
      // (pnpm's symlink layout can produce two copies otherwise).
      // We DON'T dedupe @clerk/shared — its sub-path exports
      // (e.g. /loadClerkJsScript) can't be resolved when dedupe
      // collapses it.
      dedupe: ['@clerk/clerk-react', 'react', 'react-dom'],
    },
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, 'index.html'),
          // Dedicated entry for the floating focus widget. Separate
          // HTML + entry script means the focus window doesn't share
          // any module side-effects with the main app — no #hash
          // routing, no splash fallback bleed, no ClerkProvider, no
          // StrictMode double-mount.
          focus: path.resolve(__dirname, 'focus.html'),
        },
      },
    },
  },
});
