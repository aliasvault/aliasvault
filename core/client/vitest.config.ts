import { existsSync } from 'node:fs';
import path from 'node:path';

import { defaultClientConditions, defaultServerConditions } from 'vite';
import { defineConfig } from 'vitest/config';

/*
 * The unit tests run against whichever WASM build is present (`#wasm/*` in package.json), preferring the extension one.
 */
const WASM_TARGET = existsSync(path.join(import.meta.dirname, 'wasm-extension')) ? 'extension' : 'web';

export default defineConfig({
  resolve: { conditions: [`aliasvault-${WASM_TARGET}`, ...defaultClientConditions] },
  ssr: { resolve: { conditions: [`aliasvault-${WASM_TARGET}`, ...defaultServerConditions] } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    fsModuleCache: true,
    env: { ALIASVAULT_WASM_DIR: path.join(import.meta.dirname, `wasm-${WASM_TARGET}`) },
  },
});
