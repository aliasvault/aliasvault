import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const CORE_DIR = path.resolve(import.meta.dirname, '../../core');
const LOCALES_DIR = path.resolve(import.meta.dirname, 'src/i18n/locales');
const APP_VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * Serve the loadingScreen strings of every src/i18n/locales/<lang>.json as /locales/<lang>.json, which the loading
 * screen script in index.html fetches before the app bundle has loaded.
 */
function loadingScreenLocales(): Plugin {
  /**
   * The loading screen JSON of one language, or null when the language has no locale file.
   */
  const read = (lang: string): string | null => {
    const file = path.join(LOCALES_DIR, `${lang}.json`);
    if (!existsSync(file)) {
      return null;
    }
    const locale = JSON.parse(readFileSync(file, 'utf8')) as { loadingScreen?: unknown };
    return JSON.stringify(locale.loadingScreen ?? {});
  };

  return {
    name: 'loading-screen-locales',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const match = /^\/locales\/([a-z]{2})\.json(?:\?.*)?$/.exec(req.url ?? '');
        if (!match) {
          next();
          return;
        }
        const body = read(match[1]);
        res.statusCode = body ? 200 : 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(body ?? '{}');
      });
    },
    generateBundle() {
      for (const file of readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'))) {
        this.emitFile({ type: 'asset', fileName: `locales/${file}`, source: read(path.basename(file, '.json')) ?? '{}' });
      }
    },
  };
}

// See https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
    },
  },
  server: {
    port: 3000,
    // Allow to serve files from the shared core directory (linked via file: dependencies).
    fs: {
      allow: [path.resolve('.'), CORE_DIR],
    },
  },
  optimizeDeps: {
    exclude: ['@aliasvault/client', '@aliasvault/models', '@aliasvault/vault'],
  },
  build: {
    target: 'es2022',
  },
  plugins: [
    react(),
    loadingScreenLocales(),
    viteStaticCopy({
      targets: [
        { src: path.resolve(CORE_DIR, 'client/wasm/aliasvault_core_bg.wasm'), dest: 'wasm' },
      ],
    }),
  ],
});
