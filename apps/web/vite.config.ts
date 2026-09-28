import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

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

/**
 * Preload the content hashed Rust core wasm from index.html, so its download runs in parallel with the app bundle.
 */
function preloadCoreWasm(): Plugin {
  return {
    name: 'preload-core-wasm',
    apply: 'build',
    transformIndexHtml(_html, context) {
      const wasm = Object.values(context.bundle ?? {}).find((chunk) => chunk.type === 'asset' && /aliasvault_core_bg-.*\.wasm$/.test(chunk.fileName));
      if (!wasm) {
        throw new Error('The Rust core wasm asset is missing from the bundle.');
      }
      return [{ tag: 'link', attrs: { rel: 'preload', href: `/${wasm.fileName}`, as: 'fetch', type: 'application/wasm', crossorigin: 'anonymous' }, injectTo: 'head' }];
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
    preloadCoreWasm(),
  ],
});
