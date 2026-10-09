import path from 'node:path';

import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [
    WxtVitest(),
  ],
  resolve: { conditions: ['aliasvault-extension', ...defaultClientConditions] },
  ssr: { resolve: { conditions: ['aliasvault-extension', ...defaultServerConditions] } },
  test: {
    env: { ALIASVAULT_WASM_DIR: path.resolve(import.meta.dirname, '../../core/client/wasm-extension') },
    exclude: ['**/node_modules/**', '**/tests/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
