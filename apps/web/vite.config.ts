import { readFileSync } from 'node:fs';
import path from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

const CORE_DIR = path.resolve(import.meta.dirname, '../../core');
const APP_VERSION = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string }).version;

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
    viteStaticCopy({
      targets: [
        { src: path.resolve(CORE_DIR, 'client/wasm/aliasvault_core_bg.wasm'), dest: 'wasm' },
      ],
    }),
  ],
});
