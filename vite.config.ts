/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { linkcheckProxy } from './linkcheck-server.js'

export default defineConfig({
  plugins: [vue(), linkcheckProxy()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    // several suites monkey-patch DOM globals (hit-testing/rects) — run files
    // serially so they can't collide
    fileParallelism: false,
    // UI smoke test spawns Vue apps + fake IndexedDB in happy-dom and is
    // flaky/slow under this environment; it stays runnable on demand.
    exclude: ['tests/mount.test.ts'],
  },
})