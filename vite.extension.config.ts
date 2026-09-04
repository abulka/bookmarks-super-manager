import { fileURLToPath, URL } from 'node:url'
import { readFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

const pkg = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string; repository?: unknown }

/** "owner/repo" for the update feed (extends package.json `repository`). */
function updateRepo(): string {
  const repo = pkg.repository
  if (typeof repo === 'string') return repo
  if (repo && typeof repo === 'object') {
    const { url } = repo as { url?: string }
    const m = url?.match(/\.com\/([^/]+\/[^/.#]+)/)
    if (m) return m[1]
  }
  return ''
}

/**
 * Finalise dist-extension after the bundle is written: copy manifest.json
 * (with the version baked in from package.json), and strip files Chrome
 * reserves at the package root (names starting with "_", e.g. Netlify's
 * _redirects from public/) — unpacked extensions refuse to load when such
 * files are present.
 */
function copyManifest(): Plugin {
  return {
    name: 'copy-extension-manifest',
    closeBundle() {
      const out = fileURLToPath(new URL('./dist-extension', import.meta.url))
      mkdirSync(out, { recursive: true })
      const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8')) as { version: string }
      writeFileSync(`${out}/manifest.json`, JSON.stringify({ ...manifest, version: pkg.version }, null, 2))
      for (const entry of readdirSync(out)) {
        if (entry.startsWith('_')) rmSync(`${out}/${entry}`, { recursive: true, force: true })
      }
    },
  }
}

export default defineConfig({
  plugins: [vue(), copyManifest()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __UPDATE_REPO__: JSON.stringify(updateRepo()),
  },
  build: {
    outDir: 'dist-extension',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        extension: fileURLToPath(new URL('./extension.html', import.meta.url)),
        background: fileURLToPath(new URL('./src/background.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
})
