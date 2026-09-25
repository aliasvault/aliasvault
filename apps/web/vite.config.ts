import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const CORE_DIR = path.resolve(import.meta.dirname, '../../core');
const LOCALES_DIR = path.resolve(import.meta.dirname, 'src/i18n/locales');
const APP_VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

/**
 * Inline the loadingScreen strings of every src/i18n/locales/<lang>.json into index.html, so the loading screen
 * script shows the right language on the first load without needing a separate request.
 */
function loadingScreenLocales(): Plugin {
  return {
    name: 'loading-screen-locales',
    transformIndexHtml() {
      const translations: Record<string, unknown> = {};
      for (const file of readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'))) {
        const locale = JSON.parse(readFileSync(path.join(LOCALES_DIR, file), 'utf8')) as { loadingScreen?: unknown };
        if (locale.loadingScreen) {
          translations[path.basename(file, '.json')] = locale.loadingScreen;
        }
      }

      // Escape "<" so no string can close the script element.
      const json = JSON.stringify(translations).replace(/</g, '\\u003c');
      return [{ tag: 'script', attrs: { type: 'application/json', id: 'loading-screen-translations' }, children: json, injectTo: 'body-prepend' }];
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
